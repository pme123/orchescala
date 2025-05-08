package orchescala.api

class exportsTest extends munit.FunSuite:

  test("orchescala.api.DefaultApiCreator UNDEFINED") :
    assertEquals(
      shortenTag("orchescala.api.DefaultApiCreator"),
      "Orchescala api Default Api Creator"
    )
  test("mycompany-myproject-myprocess.MyWorker") :
    assertEquals(
      shortenTag("mycompany-myproject-myprocess.MyWorker"),
      "Myprocess My Worker"
    )
  test("mycompany-myproject-myprocess.MyWorker.get") :
    assertEquals(
      shortenTag("mycompany-myproject-myprocess.MyWorker.get"),
      "My Worker get"
    )
  test("mycompany-myproject-myprocessV2-GetMyWorker") :
    assertEquals(
      shortenTag("mycompany-myproject-myprocessV2-MyWorker"),
      "My Worker"
    )
  test("mycompany-myproject-myprocessV4.MyWorker") :
    assertEquals(
      shortenTag("mycompany-myproject-myprocessV4.MyWorker"),
      "My Worker"
    )
  
end exportsTest