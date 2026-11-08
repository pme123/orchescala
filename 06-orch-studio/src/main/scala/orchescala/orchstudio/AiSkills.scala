package orchescala.orchstudio

/** The tasks of the AI and their skills (E23). A task is offered only if the studio has a skill for
  * it and its provider: `ai/skills/<task>/<provider>/SKILL.md` on the classpath. The skill holds the
  * constraints, the steps and the instructions for the model - written to be reviewed by a bank.
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

  def path(task: Task, provider: String): String = s"ai/skills/${task.id}/$provider/SKILL.md"

  /** The tasks with a skill for `provider` - the ones orch-spec may show. */
  def available(provider: String, loader: ClassLoader = getClass.getClassLoader): Seq[Task] =
    Task.values.toSeq.filter(t => loader.getResource(path(t, provider)) != null)

end AiSkills
