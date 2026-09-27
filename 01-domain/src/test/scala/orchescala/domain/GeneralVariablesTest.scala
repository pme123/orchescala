package orchescala.domain

// sbt domain/testOnly *GeneralVariablesTest
class GeneralVariablesTest extends munit.FunSuite:

  // C8 passes `_outputVariables` as the raw String from the BPMN (the C7 extractor already
  // splits and trims it) - "a, b" must not become Seq("a", " b"), otherwise `b` is silently
  // dropped from the worker output.
  test("outputVariableSeq trims comma separated names"):
    val gv = GeneralVariables(_outputVariables = Some("editAccountNumber, accountType ,,"))
    assertEquals(gv.outputVariableSeq, Seq("editAccountNumber", "accountType"))

  test("outputVariableSeq keeps a Seq as is"):
    val gv = GeneralVariables(_outputVariables = Some(Seq("a", "b")))
    assertEquals(gv.outputVariableSeq, Seq("a", "b"))

  test("outputVariableSeq is empty for None and empty String"):
    assertEquals(GeneralVariables(_outputVariables = None).outputVariableSeq, Seq.empty)
    assertEquals(GeneralVariables(_outputVariables = Some("")).outputVariableSeq, Seq.empty)

  test("handledErrorSeq / mockedWorkerSeq trim as well"):
    val gv = GeneralVariables(
      _handledErrors = Some("output-mocked, validation-failed"),
      _mockedWorkers = Some("w1 , w2")
    )
    assertEquals(gv.handledErrorSeq, Seq("output-mocked", "validation-failed"))
    assertEquals(gv.mockedWorkerSeq, Seq("w1", "w2"))

end GeneralVariablesTest
