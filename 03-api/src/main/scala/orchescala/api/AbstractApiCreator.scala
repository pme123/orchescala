package orchescala
package api

import orchescala.domain.*
import sttp.apispec.openapi.*

trait AbstractApiCreator extends ProcessReferenceCreator:

  protected def apiConfig: ApiConfig

  protected given tenantId: Option[String] = apiConfig.tenantId

  protected def basePath: os.Path = apiConfig.basePath

  protected def title: String

  protected def version: String

  protected def servers = List(
    Server(apiConfig.endpoint).description("Local Developer Server")
  )

  def main(args: Array[String]): Unit = () // starts the app

  /** You can adjust the OpenApi for Postman, e.g. to replace some values with placeholders.
    *
    * @param api
    * @return
    *   adjusted api
    */
  protected def adjustPostmanOpenApi(api: String): String = api

  protected def info(title: String, description: Option[String]) =
    Info(title, version, description, contact = apiConfig.contact)

  protected def createLink(
      name: String,
      groupAnchor: Option[String] = None
  ): String =
    val projName = s"${apiConfig.docBaseUrl.mkString}/${apiConfig.companyName}/$projectName"
    val anchor   = groupAnchor
      .map(_ =>
        s"operation/${name.replace(" ", "%20")}"
      )
      .getOrElse(s"tag/${name.replace(" ", "-").replace("--", "-").replace("--", "-")}")
    s"[$name]($projName/OpenApi.html#$anchor)"
  end createLink

  extension (inOutApi: InOutApi[?, ?])
    def endpointName(inOutDocu: InOutDocu): String =
      val name        = (inOutApi, inOutApi.inOut.in) match
        case (_: ServiceWorkerApi[?, ?, ?, ?], _) => inOutApi.inOutDescr.shortName
        case _                                    => inOutApi.inOutDescr.shortName
      val typePostfix = (inOutDocu, inOutApi.inOutType) match
        case (InOutDocu.IN, InOutType.UserTask) => " complete"
        case (_, InOutType.UserTask)            => " variables"
        case _                                  => ""
      s"${inOutApi.inOutType}$typePostfix: $name"
  end extension

end AbstractApiCreator
