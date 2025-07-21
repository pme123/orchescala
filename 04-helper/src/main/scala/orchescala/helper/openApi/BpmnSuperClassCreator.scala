package orchescala.helper.openApi

import io.swagger.v3.oas.models.ExternalDocumentation
import io.swagger.v3.oas.models.info.Info

case class BpmnSuperClassCreator(
    info: Info,
    maybeDoc: Option[ExternalDocumentation]
):

  lazy val create: BpmnSuperClass =
    BpmnSuperClass(
      Option(info.getTitle).getOrElse("No Title in Open API"),
      Option(info.getVersion),
      Option(info.getDescription),
      Option(externalDoc.getDescription),
      Option(externalDoc.getUrl)
    )
  end create

  private lazy val externalDoc = maybeDoc.getOrElse(new ExternalDocumentation())

end BpmnSuperClassCreator
