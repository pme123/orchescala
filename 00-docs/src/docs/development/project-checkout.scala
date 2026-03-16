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

// SSH agent environment variables captured after starting the agent
var sshAuthSock = ""
var sshAgentPid = ""

// Start SSH agent and capture its environment variables into sshAuthSock / sshAgentPid.
// Using System.setProperty would only set Java properties, not OS env vars, so child
// processes (ssh-add, git) would never see them. We store them here and pass them
// explicitly to every child process instead.
def startSshAgent(): Unit =
  println("Starting SSH agent...")
  val result = Process(Seq("ssh-agent", "-s")).!!
  // Parse output lines like: SSH_AUTH_SOCK=/tmp/ssh-XXX/agent.123; export SSH_AUTH_SOCK;
  result.split('\n').foreach { line =>
    val parts = line.split(';').head.split('=')
    if parts.length == 2 then
      parts(0).trim match
        case "SSH_AUTH_SOCK" => sshAuthSock = parts(1).trim
        case "SSH_AGENT_PID" => sshAgentPid = parts(1).trim
        case _               =>
  }
  if sshAuthSock.isEmpty || sshAgentPid.isEmpty then
    println("Failed to start SSH agent (could not parse SSH_AUTH_SOCK / SSH_AGENT_PID).")
    sys.exit(1)
end startSshAgent

// Convenience: returns the agent env-var pairs to pass to every child process
def agentEnv: Seq[(String, String)] =
  Seq("SSH_AUTH_SOCK" -> sshAuthSock, "SSH_AGENT_PID" -> sshAgentPid)

// Check if SSH key is already added to the agent
def checkAndAddSshKey(): Unit =
  // Pass the agent env vars so that ssh-add can reach the running agent socket
  val checkResult = Try(
    Process(Seq("ssh-add", "-l"), None, agentEnv*).!(ProcessLogger(_ => ()))
  )

  checkResult match
  case Success(0) =>
    println("SSH key passphrase is already cached.")
  case _          =>
    println("SSH key passphrase is not cached. Please enter your SSH private key passphrase:")
    val addResult = Process(Seq("ssh-add"), None, agentEnv*).!
    if addResult == 0 then
      keyAdded = true
    else
      println("Failed to add SSH key.")
      sys.exit(1)
    end if
  end match
end checkAndAddSshKey

// Function to clean up SSH agent.
// SSH_AGENT_PID must be in the environment so that ssh-agent -k targets the correct agent.
def cleanupSshAgent(): Unit =
  if keyAdded then
    Process(Seq("ssh-agent", "-k"), None, agentEnv*).!
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

  // Clone the repository using the SSH URL; pass agent env vars so git uses the running agent
  val cloneResult =
    Process(Seq("git", "clone", cloneUrl, companyDirectory.getAbsolutePath), None, agentEnv*).!

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

  // Clone the repository using the SSH URL; pass agent env vars so git uses the running agent
  val cloneResult =
    Process(Seq("git", "clone", cloneUrl, projectDir.getAbsolutePath), None, agentEnv*).!

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
