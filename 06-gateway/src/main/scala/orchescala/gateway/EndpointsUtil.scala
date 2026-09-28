package orchescala.gateway

import orchescala.gateway.GatewayError.ServiceRequestError
import sttp.model.StatusCode

object EndpointsUtil:

  lazy val baseEndpoint = endpoint
    .securityIn(auth.bearer[String]())
    .errorOut(
      oneOf[ServiceRequestError](
        oneOfVariantValueMatcher(statusCode(StatusCode.Unauthorized)
          .and(jsonBody[ServiceRequestError]
            .example(
              ServiceRequestError(401, "Problem authenticating request: error")
            ))) { case e: ServiceRequestError if e.errorCode == 401 => true },
        oneOfVariantValueMatcher(statusCode(StatusCode.BadRequest)
          .and(jsonBody[ServiceRequestError]
            .example(ServiceRequestError(
              400,
              "There is no body in the response and the ServiceOut is neither NoOutput nor Option (Class is class java.lang.String)."
            )))) {
          case e: ServiceRequestError if e.errorCode == 400 => true
        },
        oneOfVariantValueMatcher(statusCode(StatusCode.NotFound)
          .and(jsonBody[ServiceRequestError]
            .example(ServiceRequestError(404, "Not Found")))) {
          case e: ServiceRequestError if e.errorCode == 404 => true
        },
        oneOfVariantValueMatcher(statusCode(StatusCode.InternalServerError)
          .and(jsonBody[ServiceRequestError]
            .example(ServiceRequestError(500, "Internal Server Error")))) {
          case e: ServiceRequestError if e.errorCode == 500 => true
        },
        // any other status as it is (403, 409, 503, ...) - not 400 for all of them
        oneOfDefaultVariant(
          statusCode
            .and(jsonBody[ServiceRequestError])
            .map((_, error) => error)(error => (httpStatus(error), error))
        )
      )
    )

  private[gateway] def httpStatus(error: ServiceRequestError): StatusCode =
    if error.errorCode >= 400 && error.errorCode < 600 then StatusCode(error.errorCode)
    else StatusCode.InternalServerError

end EndpointsUtil
