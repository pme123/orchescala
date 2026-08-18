addSbtPlugin("com.github.sbt" % "sbt-native-packager" % "1.11.7")

// https://github.com/djspiewak/sbt-github-actions
//addSbtPlugin("com.codecommit" % "sbt-github-actions" % "0.13.0")
addSbtPlugin("com.github.sbt" % "sbt-ci-release" % "1.11.2")
addSbtPlugin("org.typelevel"  % "laika-sbt"      % "1.3.2")
addSbtPlugin("org.scalameta"  % "sbt-mdoc"       % "2.9.0")

addSbtPlugin("com.eed3si9n" % "sbt-buildinfo" % "0.13.1")

// DMN Tester: shared model is cross built, the client is Scala.js
addSbtPlugin("org.scala-js"      % "sbt-scalajs"              % "1.22.0")
addSbtPlugin("org.portable-scala" % "sbt-scalajs-crossproject" % "1.4.0")

addDependencyTreePlugin // sbt dependencyBrowseTreeHTML -> target/tree.html
