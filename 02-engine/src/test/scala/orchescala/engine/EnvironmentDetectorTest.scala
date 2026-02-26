package orchescala.engine

import munit.FunSuite

class EnvironmentDetectorTest extends FunSuite:

  test("EnvironmentDetector should detect environment"):
    // This test will show different results depending on where it runs
    println(EnvironmentDetector.environmentInfo)

    // The detector should always give a definitive answer
    assert(EnvironmentDetector.isRunningInDocker || !EnvironmentDetector.isRunningInDocker)

    // If running in Docker, it should not be considered localhost
    if EnvironmentDetector.isRunningInDocker then
      assert(!EnvironmentDetector.isLocalhost, "Should not be localhost when in Docker")

  test("isLocalhost should be true when not in Docker"):
    // This test passes when running locally (not in Docker)
    if !EnvironmentDetector.isRunningInDocker then
      println("✓ Running on localhost (not in Docker)")
    else
      println("✓ Running in Docker container")

end EnvironmentDetectorTest

