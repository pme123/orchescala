addSbtPlugin("com.github.sbt" % "sbt-native-packager" % "1.13.0")

// https://github.com/djspiewak/sbt-github-actions
//addSbtPlugin("com.codecommit" % "sbt-github-actions" % "0.13.0")
addSbtPlugin("com.github.sbt" % "sbt-ci-release" % "1.12.1")
addSbtPlugin("org.scalameta"  % "sbt-mdoc"       % "2.9.2")

addSbtPlugin("com.eed3si9n" % "sbt-buildinfo" % "0.13.2")

// DMN Tester: shared model is cross built, the client is Scala.js
addSbtPlugin("org.scala-js"      % "sbt-scalajs"              % "1.23.0")
addSbtPlugin("org.portable-scala" % "sbt-scalajs-crossproject" % "1.4.0")
