package orchescala.helper.dev.publish

/** Before the first sbt run of a release with a docker image: `--platform` (the default, for
  * OpenShift's amd64) needs BuildKit - the `buildx` plugin of the docker CLI; the legacy
  * builder fails with "does not provide the specified platform", after the build of everything
  * else. So it is checked first.
  */
object DockerCheck:

  /** Fails with the way to get `buildx` when `dockerBuildOptions` ask for a platform and the
    * docker CLI has no `buildx`. `exitCode` runs a command and gives its exit code.
    */
  def verifyBuildx(dockerBuildOptions: Seq[String], exitCode: Seq[String] => Int = run): Unit =
    if dockerBuildOptions.contains("--platform") then
      val code = exitCode(Seq("docker", "buildx", "version"))
      if code != 0 then
        throw IllegalStateException(
          "`docker buildx version` fails - the docker images are built for a platform " +
            s"(${dockerBuildOptions.mkString(" ")}), which needs BuildKit, the `buildx` plugin of the docker CLI. " +
            "With Homebrew: `brew install docker-buildx`, then link it: `mkdir -p ~/.docker/cli-plugins && " +
            "ln -sfn $(brew --prefix)/opt/docker-buildx/bin/docker-buildx ~/.docker/cli-plugins/docker-buildx`."
        )
      else println("docker buildx is there - the images can be built for the platform.")
  end verifyBuildx

  private def run(cmd: Seq[String]): Int =
    try os.proc(cmd).call(check = false, stdout = os.Pipe, stderr = os.Pipe).exitCode
    catch case _: java.io.IOException => 127 // no docker at all - the build says so

end DockerCheck
