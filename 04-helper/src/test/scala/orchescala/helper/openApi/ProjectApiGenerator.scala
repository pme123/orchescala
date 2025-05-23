package orchescala.helper.openApi

// helper/test:run
object ProjectApiGenerator extends App:

  OpenApiGenerator().generate

  private given OpenApiConfig = camundaConf
  private lazy val typeMappers =
    OpenApiConfig.generalTypeMapping ++
      Seq(
        TypeMapper("AnyValue", "Json", OpenApiConfig.jsonObj)
      )
  private given ApiDefinition = OpenApiCreator().create
  private lazy val camundaConf = OpenApiConfig(
    projectName = "mycompany-services",
    subProjectName = Some("camunda"),
    openApiFile = os.rel / "camundaOpenApi.json",
    typeMappers = typeMappers,
    superWorkerClass = "orchescala.worker.ServiceWorkerDsl",
    filterNames = Seq("{id}")
  )
  
end ProjectApiGenerator
