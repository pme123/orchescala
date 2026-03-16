#!/usr/bin/env -S scala shebang

//> using scala 3.8.1
//> using dep com.lihaoyi::os-lib:0.11.3

import scala.sys.process.*
import scala.util.{Try, Success, Failure}
import java.io.File

// Base Git URL for cloning, using SSH format
val baseUrl = "code.mycompany.com:2222/myrepos"

val company = "mycompany"

// List of projects to clone
val projects = Seq(
  "mycompany-services",
  "mycompany-cards"
)

// Track if we added the key in this session
var keyAdded = false

// Start SSH agent
def startSshAgent(): Unit =
  println("Starting SSH agent...")
  val result = Process("ssh-agent -s").!!
  // Parse and set environment variables
  result.split('\n').foreach { line =>
    if line.contains("SSH_AUTH_SOCK") || line.contains("SSH_AGENT_PID") then
      val parts = line.split(';').head.split('=')
      if parts.length == 2 then
        System.setProperty(parts(0), parts(1))
  }
end startSshAgent

// Check if SSH key is already added to the agent
def checkAndAddSshKey(): Unit =
  val checkResult = Try(Process("ssh-add -l").!(ProcessLogger(_ => ())))

  checkResult match
  case Success(0) =>
    println("SSH key passphrase is already cached.")
  case _          =>
    println("SSH key passphrase is not cached. Please enter your SSH private key passphrase:")
    val addResult = Process("ssh-add").!
    if addResult == 0 then
      keyAdded = true
    else
      println("Failed to add SSH key.")
      sys.exit(1)
    end if
  end match
end checkAndAddSshKey

// Function to clean up SSH agent
def cleanupSshAgent(): Unit =
  if keyAdded then
    Process("ssh-agent -k").!
    println("SSH agent cleaned up.")
  else
    println("SSH agent retention since passphrase was already cached.")

// Function to prompt user for yes/no
def promptYesNo(message: String): Boolean =
  print(s"$message (y/n): ")
  scala.io.StdIn.readLine().toLowerCase == "y"

// Clone a company project
def cloneCompanyProject(): Unit =
  println(s"Processing $company...")
  val companyProject = s"$company-orchescala"

  val companyDirectory = new File(companyProject)

  // Check if the directory already exists
  if companyDirectory.exists() then
    if !promptYesNo(s"Directory $companyProject already exists. Overwrite?") then
      println(s"Skipping $companyProject.")
    else
      // Remove the existing directory if overwrite is confirmed
      os.remove.all(os.Path(companyDirectory.getAbsolutePath))
    end if
  end if

  // Construct the full clone URL using SSH
  val cloneUrl = s"ssh://git@$baseUrl/$companyProject.git"

  println(s"Cloning $companyProject from $cloneUrl...")

  // Clone the repository using the SSH URL
  val cloneResult = Process(Seq("git", "clone", cloneUrl, companyDirectory.getAbsolutePath)).!

  // Check if the clone was successful
  if cloneResult == 0 then
    println(s"Successfully cloned $companyProject.")
  else
    println(
      s"Failed to clone $companyProject. Please check the URL, your SSH setup, or your network connection."
    )
  end if

  println()

end cloneCompanyProject

// Clone a single project
def cloneProject(project: String): Unit =
  println(s"Processing $project...")

  val projectDir = new File(s"projects/$project")

  // Check if the directory already exists
  if projectDir.exists() then
    if !promptYesNo(s"Directory $project already exists. Overwrite?") then
      println(s"Skipping $project.")
    else
      // Remove the existing directory if overwrite is confirmed
      os.remove.all(os.Path(projectDir.getAbsolutePath))
  end if

  // Construct the full clone URL using SSH
  val cloneUrl = s"ssh://git@$baseUrl/$project.git"

  println(s"Cloning $project from $cloneUrl...")

  // Clone the repository using the SSH URL
  val cloneResult = Process(Seq("git", "clone", cloneUrl, projectDir.getAbsolutePath)).!

  // Check if the clone was successful
  if cloneResult == 0 then
    println(s"Successfully cloned $project.")
  else
    println(
      s"Failed to clone $project. Please check the URL, your SSH setup, or your network connection."
    )
  end if

  println()
end cloneProject

@main
def run(): Unit =
  // Set up shutdown hook for cleanup
  sys.addShutdownHook {
    cleanupSshAgent()
  }

  try
    // Start SSH agent and add key
    startSshAgent()
    checkAndAddSshKey()

    cloneCompanyProject()
    // Iterate over the project list and clone each
    projects.foreach(cloneProject)

    println("Cloning process completed.")
  catch
    case e: Exception =>
      println(s"Error: ${e.getMessage}")
      sys.exit(1)
  end try
end run
