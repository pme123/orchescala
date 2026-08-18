package orchescala.dmntester

import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.{Decoder, Encoder}

/** Domain errors of the tester - never throw, always return these. */
sealed trait HandledTesterException:
  def msg: String

object HandledTesterException:

  case class ConfigException(msg: String) extends HandledTesterException

  object ConfigException:
    given Decoder[ConfigException] = deriveDecoder
    given Encoder[ConfigException] = deriveEncoder

  case class EvalException(decisionId: String, msg: String)
      extends HandledTesterException

  object EvalException:
    given Decoder[EvalException] = deriveDecoder
    given Encoder[EvalException] = deriveEncoder

  given Decoder[HandledTesterException] = deriveDecoder
  given Encoder[HandledTesterException] = deriveEncoder
end HandledTesterException
