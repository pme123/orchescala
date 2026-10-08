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
  def verifyBuildx(
      dockerBuildOptions: Seq[String],
      exitCode: Seq[String] => Int = run,
      output: Seq[String] => String = out
  ): Unit =
    if dockerBuildOptions.exists(_.startsWith("--platform")) then // `--platform x` and `--platform=x`
      val code = exitCode(Seq("docker", "buildx", "version"))
      if code != 0 then
        throw IllegalStateException(
          "`docker buildx version` fails - the docker images are built for a platform " +
            s"(${dockerBuildOptions.mkString(" ")}), which needs BuildKit, the `buildx` plugin of the docker CLI. " +
            "With Homebrew: `brew install docker-buildx`, then link it: `mkdir -p ~/.docker/cli-plugins && " +
            "ln -sfn $(brew --prefix)/opt/docker-buildx/bin/docker-buildx ~/.docker/cli-plugins/docker-buildx`."
        )
      // the image must land in the local daemon (`Docker / publishLocal`, then the push): only
      // the `docker` driver does - a `docker-container` builder keeps it in its own cache
      val driver = builderDriver(output(Seq("docker", "buildx", "inspect")))
      driver match
        case Some("docker") => println("docker buildx is there, its builder keeps the images in the daemon.")
        case Some(other)    =>
          throw IllegalStateException(
            s"The current buildx builder uses the `$other` driver - an image built for a platform does not " +
              "land in the local daemon, the push would find none. Use the default builder: `docker buildx use default`."
          )
        case None           => println("docker buildx is there (its builder's driver is unknown - `docker buildx inspect` said nothing).")
  end verifyBuildx

  /** The `Driver:` of `docker buildx inspect` - None when there is none in the output. */
  def builderDriver(inspect: String): Option[String] =
    Driver.findFirstMatchIn(inspect).map(_.group(1))

  private val Driver = """(?m)^\s*Driver:\s*(\S+)""".r

  private def out(cmd: Seq[String]): String =
    try os.proc(cmd).call(check = false, stdout = os.Pipe, stderr = os.Pipe).out.text()
    catch case _: java.io.IOException => ""

  private def run(cmd: Seq[String]): Int =
    try os.proc(cmd).call(check = false, stdout = os.Pipe, stderr = os.Pipe).exitCode
    catch case _: java.io.IOException => 127 // no docker at all - the build says so

end DockerCheck
