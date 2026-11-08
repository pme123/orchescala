package orchescala.orchstudio

import io.circe.{ACursor, Decoder}

/** The tasks of the AI and their skills (E23). A task is offered only if the studio has a skill for
  * it and its provider: `ai/skills/<task>/<provider>/SKILL.md` on the classpath. The skill holds the
  * constraints, the steps and the instructions for the model - written to be reviewed by a bank.
  *
  * The studio applies what it can per request (see [[AiRoutes]]): the instructions, the model, the
  * settings of `request` and the tools. The limits per turn and per person come with the agent on the
  * server.
  *
  * The studio brings its skills; a company can add one - or replace one - with the same path in the
  * resources of its module `studio` (the first one on the classpath wins).
  */
object AiSkills:

  /** The tasks orch-spec knows - each has its place in the UI. */
  enum Task(val id: String):
    /** the pages of an app, in the page designer */
    case uiCreator extends Task("uiCreator")
    /** the processes, in the process view */
    case processCreator extends Task("processCreator")
    /** a service from an OpenAPI, in the catalog */
    case serviceRegistration extends Task("serviceRegistration")
    /** a new service collection */
    case serviceCreator extends Task("serviceCreator")

  /** A skill as the studio applies it.
    *
    * @param model        the model of the skill - without one, the model of the studio (`STUDIO_AI_MODEL`)
    * @param maxTokens    `request.max_tokens` - the most a request may ask for
    * @param thinking     `request.thinking`, e.g. `adaptive`
    * @param effort       `request.effort`, e.g. `medium`
    * @param fallbacks    `request.fallbacks`, e.g. `default` - another Claude model answers if a safety filter declines
    * @param tools        the only tools a request may offer the model
    * @param instructions the section `## Instructions` - the first part of the system of every request
    */
  final case class Skill(
      task: Task,
      provider: String,
      name: String,
      version: Int,
      model: Option[String],
      maxTokens: Option[Int],
      thinking: Option[String],
      effort: Option[String],
      fallbacks: Option[String],
      tools: Seq[String],
      instructions: String
  ):
    def label: String = s"$name v$version"

  def path(task: Task, provider: String): String = s"ai/skills/${task.id}/$provider/SKILL.md"

  /** The skills for `provider` on the classpath - or what is wrong with one of them. */
  def load(provider: String, loader: ClassLoader = getClass.getClassLoader): Either[String, Seq[Skill]] =
    Task.values.toSeq
      .flatMap(t => Option(loader.getResource(path(t, provider))).map(t -> _))
      .foldLeft[Either[String, Seq[Skill]]](Right(Nil)):
        case (loaded, (task, url)) =>
          for
            skills <- loaded
            text   <- scala.util.Using(scala.io.Source.fromURL(url, "UTF-8"))(_.mkString).toEither
                        .left.map(e => s"${path(task, provider)} cannot be read: ${e.getMessage}")
            skill  <- parse(task, provider, text).left.map(e => s"${path(task, provider)}: $e")
          yield skills :+ skill

  /** A `SKILL.md`: the front matter (YAML between two lines `---`) and the section `## Instructions`. */
  def parse(task: Task, provider: String, text: String): Either[String, Skill] =
    val lines = text.linesIterator.toVector
    val end   = if lines.headOption.exists(_.trim == "---") then lines.indexWhere(_.trim == "---", 1) else -1
    for
      _            <- Either.cond(end > 0, (), "no front matter between two lines ---")
      head         <- io.circe.yaml.parser.parse(lines.slice(1, end).mkString("\n"))
                        .left.map(e => s"the front matter is no YAML: ${e.getMessage}")
      c             = head.hcursor
      request       = c.downField("request")
      name         <- c.get[String]("name").left.map(_ => "no name in the front matter")
      ofTask       <- optional[String](c, "task")
      _            <- ofTask.filter(_ != task.id).map(t => s"task «$t» is not the task of its path «${task.id}»").toLeft(())
      ofProvider   <- optional[String](c, "provider")
      _            <- ofProvider.filter(_ != provider)
                        .map(p => s"provider «$p» is not the provider of its path «$provider»").toLeft(())
      version      <- optionalInt(c, "version")
      model        <- optionalText(c, "model")
      _            <- request.focus.filterNot(j => j.isObject || j.isNull).map(_ => "«request» is no object").toLeft(())
      maxTokens    <- optionalInt(request, "max_tokens", "request.")
      _            <- maxTokens.filter(_ <= 0).map(n => s"«request.max_tokens» must be more than 0: $n").toLeft(())
      thinking     <- optionalText(request, "thinking", "request.")
      effort       <- optionalText(request, "effort", "request.")
      fallbacks    <- optionalText(request, "fallbacks", "request.")
      tools        <- c.get[Seq[String]]("tools").left.map(_ => "no list of tools in the front matter")
      instructions <- instructionsOf(lines.drop(end + 1)).toRight("no text in the section ## Instructions")
    yield Skill(
      task = task,
      provider = provider,
      name = name,
      version = version.getOrElse(1),
      model = model,
      maxTokens = maxTokens,
      thinking = thinking,
      effort = effort,
      fallbacks = fallbacks,
      tools = tools,
      instructions = instructions
    )
  end parse

  /** A field that may be missing - but if it is there, it has the type: a wrong one is no silent default. */
  private def optional[A: Decoder](c: ACursor, field: String, prefix: String = ""): Either[String, Option[A]] =
    c.downField(field).focus.filterNot(_.isNull) match
      case None    => Right(None)
      case Some(j) => j.as[A].map(Some(_)).left.map(_ => s"«$prefix$field» has the wrong type: ${j.noSpaces}")

  /** A whole number - not a text with one (circe would read «"16000"» as 16000). */
  private def optionalInt(c: ACursor, field: String, prefix: String = ""): Either[String, Option[Int]] =
    c.downField(field).focus.filterNot(_.isNull) match
      case None    => Right(None)
      case Some(j) => j.asNumber.flatMap(_.toInt).map(Some(_)).toRight(s"«$prefix$field» has the wrong type: ${j.noSpaces}")

  private def optionalText(c: ACursor, field: String, prefix: String = ""): Either[String, Option[String]] =
    optional[String](c, field, prefix).map(_.map(_.trim).filter(_.nonEmpty))

  /** The text of `## Instructions` up to the next section - without HTML comments (notes for people).
    * A line `## …` in a code fence belongs to the text; it does not end the section.
    */
  private def instructionsOf(body: Vector[String]): Option[String] =
    val start = body.indexWhere(_.trim.matches("##\\s+Instructions"))
    if start < 0 then None
    else
      val rest    = body.drop(start + 1)
      val isFence = (l: String) => l.trim.startsWith("```") || l.trim.startsWith("~~~")
      // in a fence before each line?
      val inFence = rest.scanLeft(false)((open, l) => if isFence(l) then !open else open)
      val end     = rest.indices.find(i => !inFence(i) && rest(i).startsWith("## ")).getOrElse(rest.length)
      Some(rest.take(end).mkString("\n").replaceAll("(?s)<!--.*?-->", "").trim).filter(_.nonEmpty)

end AiSkills
