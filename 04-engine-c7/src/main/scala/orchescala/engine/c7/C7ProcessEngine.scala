package orchescala.engine
package c7

import org.camunda.community.rest.client.invoker.ApiClient

class C7ProcessEngine(
    apiClient: ApiClient
)(
    val processService: ProcessService = C7ProcessService(apiClient)
) extends ProcessEngine
