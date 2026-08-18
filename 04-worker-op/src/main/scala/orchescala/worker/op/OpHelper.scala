package orchescala.worker.op

import orchescala.domain.{*, given}
import orchescala.worker.*
import orchescala.worker.WorkerError.*
import io.circe.Decoder.Result
import org.operaton.bpm.client.task.ExternalTask
import org.operaton.bpm.engine.variable.`type`.{PrimitiveValueType, ValueType}
import org.operaton.bpm.engine.variable.value.TypedValue
import zio.*

object OpHelper:

  def variableTypedOpt(
      varKey: String | InputParams
  ): HelperContext[Option[TypedValue]] =
    Option(summon[ExternalTask].getVariableTyped(varKey.toString))

  /** Returns the Variable in the Bag. If there is none it return `null`. It returns whatever
    * datatype the variable contains.
    */
  def variableOpt[A: InOutDecoder](
      varKey: String | InputParams
  ): HelperContext[IO[BadVariableError, Option[A]]] =
    for
      maybeJson <- jsonVariableOpt(varKey).mapError: err =>
                     err
      obj       <- ZIO.fromEither(
                     maybeJson
                       .map(_.as[Option[A]])
                       .getOrElse(Right(None))
                   ).mapError(err =>
                     BadVariableError(
                       s"Problem decoding Json '$varKey' to ${nameOfType[A]}: $err"
                     )
                   )
    yield obj

  def jsonVariableOpt(
      varKey: String | InputParams
  ): HelperContext[IO[BadVariableError, Option[Json]]] =
    ZIO.attempt(
      variableTypedOpt(varKey)
    )
      .mapError: err =>
        BadVariableError(s"Problem get variable for $varKey: $err")
      .flatMap:
        case Some(typedValue) if typedValue.getType == ValueType.NULL =>
          ZIO.none // k -> null as Operaton Expressions need them
        case Some(typedValue) =>
          extractValue(typedValue)
            .map(v => Some(v))
        case _                =>
          ZIO.none

  // used for input variables you can define with Array of Strings or a comma-separated String
  // if not set it returns an empty Seq
  def extractSeqFromArrayOrStringOpt(
      varKey: String | InputParams
  ): HelperContext[IO[BadVariableError, Option[Seq[String]]]] =
    jsonVariableOpt(varKey)
      .flatMap:
        case Some(value) if value.isArray  =>
          extractFromSeq(
            value
              .as[Seq[String]]
          ).map(Some.apply)
        case Some(value) if value.isString =>
          extractFromSeq(
            value
              .as[String]
              .map(_.split(",").toSeq)
          ).map(Some.apply)
        case _                             =>
          ZIO.none

  // used for input variables you can define with Array of Strings or a comma-separated String
  // if not set it returns an empty Seq
  def extractSeqFromArrayOrString(
      varKey: String | InputParams,
      defaultSeq: Seq[String | ErrorCodes] = Seq.empty
  ): HelperContext[IO[BadVariableError, Seq[String]]] =
    extractSeqFromArrayOrStringOpt(varKey)
      .map:
        _.getOrElse(defaultSeq.map(_.toString))

  /** Analog `variable(String vari)`. You can define a Value that is returned if there is no
    * Variable with this name.
    */
  def variable[A: InOutDecoder](
      varKey: String | InputParams,
      defaultObj: A
  ): HelperContext[IO[BadVariableError, A]] =
    variableOpt[A](varKey).map(
      _.getOrElse(defaultObj)
    )

  /** Returns the Variable in the Bag. B if there is no Variable with that identifier.
    */
  def variable[T: InOutDecoder](
      varKey: String | InputParams
  ): HelperContext[IO[BadVariableError, T]] =
    variableOpt(varKey)
      .flatMap(maybeVar =>
        ZIO.fromOption(
          maybeVar
        ).orElseFail:
          BadVariableError(
            s"The Variable '$varKey' is required! But does  not exist in your Process"
          )
      )
  end variable

  def topicName: HelperContext[String] =
    summon[ExternalTask].getTopicName

  extension [T](option: Option[T])

    def toEither(msg: String): HelperContext[Either[BadVariableError, T]] =
      toEither(BadVariableError(errorMsg = msg))

    def toEither[E <: WorkerError](
        error: E
    ): HelperContext[Either[E, T]] =
      option
        .map(Right(_))
        .getOrElse(
          Left(error)
        )

    def toZIO(msg: String): HelperContext[IO[BadVariableError, T]] =
      toZIO(BadVariableError(errorMsg = msg))

    def toZIO[E <: WorkerError](
        error: E
    ): HelperContext[IO[E, T]] =
      option
        .map(ZIO.succeed(_))
        .getOrElse(
          ZIO.fail(error)
        )

  end extension // Option

  def extractValue(typedValue: TypedValue): IO[BadVariableError, Json] =
    typedValue.getType match
      case pt: PrimitiveValueType if pt.getName == "json" =>
        val jsonStr = typedValue.getValue.toString
        ZIO.fromEither(io.circe.parser
          .parse(jsonStr)
          .left
          .map(ex => BadVariableError(s"Input is not valid: $ex")))

      case _: PrimitiveValueType =>
        typedValue.getValue match
          case vt: DmnValueSimple     =>
            import DmnValueSimple.given
            ZIO
              .attempt(vt.asJson)
              .mapError(ex =>
                BadVariableError(s"Input is not valid: $ex")
              )
          case en: scala.reflect.Enum =>
            ZIO
              .attempt(Json.fromString(en.toString))
              .mapError(ex =>
                BadVariableError(s"Input is not valid: $ex")
              )
          case null                   =>
            ZIO.succeed(Json.Null)
          case other                  =>
            ZIO.fail(
              BadVariableError(
                s"Input is not valid: Unexpected PrimitiveValueType: $other"
              )
            )

      case other =>
        ZIO.fail(
          BadVariableError(
            s"Unexpected ValueType ${other.getName} - but is ${typedValue.getType}"
          )
        )

  end extractValue

  private def extractFromSeq(
      variableKeys: Result[Seq[String]]
  ): HelperContext[IO[BadVariableError, Seq[String]]] =
    ZIO.fromEither(variableKeys)
      .map: varKeys =>
        varKeys.map(_.trim).filter(_.nonEmpty)
      .mapError: error =>
        BadVariableError(
          s"Could not extract Seq for an Array or comma-separated String: ${error.getMessage}"
        )

end OpHelper

