package orchescala.worker

import zio.*
import zio.Duration.{*, given}

import java.lang.management.*
import scala.jdk.CollectionConverters.*
import java.lang.Thread.State
import java.util.Date
import java.util.concurrent.ConcurrentHashMap
import scala.collection.mutable

case class ThreadMonitor(logTech: String => UIO[Unit])(using Trace):

  def analyzeThreads: ZIO[Any, Nothing, Unit] =
    val threadMXBean = ManagementFactory.getThreadMXBean
    val threads      = Thread.getAllStackTraces.keySet.asScala.toList

    // Group threads by their group name
    val threadsByGroup = threads.groupBy(_.getThreadGroup.getName)

    // Group threads by their state
    val threadsByState = threads.groupBy(_.getState)

    // Group threads by name pattern to identify common sources
    val threadPatterns = Map(
      "ZScheduler"        -> "ZIO Runtime",
      "zio"               -> "ZIO Runtime",
      "pool-"             -> "Thread Pool",
      "sbt-"              -> "SBT",
      "scala-execution-"  -> "Scala Execution Context",
      "ForkJoinPool"      -> "Fork Join Pool",
      "TopicSubscription" -> "Camunda Client",
      "Finalizer"         -> "JVM Finalizer",
      "RMI"               -> "Java RMI",
      "JMX"               -> "JMX Monitoring",
      "Timer"             -> "Timer Threads",
      "Attach"            -> "Attach Listener",
      "HttpClient"        -> "HTTP Client",
      "async-http-client"   -> "AsyncHTTP Client",
      "sttp-"             -> "STTP Client"
    )

    val threadsByPattern = mutable.Map.empty[String, List[Thread]]
    threads.foreach { thread =>
      val name     = thread.getName
      val matched  = threadPatterns.keys.find(pattern => name.contains(pattern))
      val category = matched.map(threadPatterns).getOrElse(name)
      threadsByPattern.put(category, thread :: threadsByPattern.getOrElse(category, List.empty))
    }

    // Analyze thread stacks to find potential issues
    val blockedThreads = threads.filter(_.getState == State.BLOCKED)
    val waitingThreads = threads.filter(t =>
      t.getState == State.WAITING || t.getState == State.TIMED_WAITING
    )

    // Get thread stack traces for blocked threads
    val blockedThreadStacks = blockedThreads.map { thread =>
      val stackTrace = thread.getStackTrace
      (thread, stackTrace)
    }

    // Analyze for common blocking points
    val blockingPoints = blockedThreadStacks
      .flatMap { case (_, stackTrace) =>
        stackTrace.headOption.map(_.toString)
      }
      .groupBy(identity)
      .map { case (point, occurrences) => (point, occurrences.size) }
      .toList
      .sortBy(-_._2)
      .take(5)

    for
      _ <- logTech("===== Thread Analysis =====")
      _ <- logTech(s"Total Threads: ${Thread.activeCount()}")

      // Log threads by group
      _ <- logTech("--- Threads by Group ---")
      _ <- ZIO.foreachDiscard(threadsByGroup.toList.sortBy(-_._2.size)) {
             case (group, threads) =>
               logTech(s"Group '$group': ${threads.size} threads")
           }

      // Log threads by state
      _ <- logTech("--- Threads by State ---")
      _ <- ZIO.foreachDiscard(threadsByState.toList) { case (state, threads) =>
             logTech(s"$state: ${threads.size} threads")
           }

      // Log threads by pattern
      _ <- logTech("--- Threads by Category ---")
      _ <- ZIO.foreachDiscard(threadsByPattern.toList.sortBy(_._1)) {
             case (pattern, threads) =>
               logTech(s"$pattern: ${threads.size} threads")
           }

      // Log blocked threads and their blocking points
      _   <- logTech("--- Top Blocking Points ---")
      res <-
        ZIO.foreach(blockingPoints):
          case (point, count) =>
            ZIO.succeed(s"$count threads blocked at: $point")
      _   <- logTech(res.mkString("\n", "\n", ""))

      // Log thread creation history if available
      _ <- logThreadCreationHistory
    yield ()
    end for
  end analyzeThreads

  // Track thread creation history
  private val threadCreationHistory = new ConcurrentHashMap[String, Long]()
  private val threadHistoryEnabled  = true

  private def logThreadCreationHistory: ZIO[Any, Nothing, Unit] =
    if threadHistoryEnabled then
      val currentThreads     = Thread.getAllStackTraces.keySet.asScala.toList
      val currentThreadNames = currentThreads.map(_.getName).toSet

      // Find new threads
      val newThreads = currentThreadNames.filter(!threadCreationHistory.containsKey(_))

      // Update history
      newThreads.foreach(name => threadCreationHistory.put(name, new Date().getTime()))

      // Find disappeared threads
      val allKnownThreads    = threadCreationHistory.keySet().asScala.toSet
      val disappearedThreads = allKnownThreads.diff(currentThreadNames)

      // Remove disappeared threads from history
      disappearedThreads.foreach(threadCreationHistory.remove)

      // Group threads by creation time ranges
      val now       = new Date().getTime
      val last5Min  = currentThreads.count(t =>
        Option(threadCreationHistory.get(t.getName)).exists(time => now - time < 5 * 60 * 1000)
      )
      val last30Min = currentThreads.count(t =>
        Option(threadCreationHistory.get(t.getName)).exists(time => now - time < 30 * 60 * 1000)
      )
      val lastHour  = currentThreads.count(t =>
        Option(threadCreationHistory.get(t.getName)).exists(time => now - time < 60 * 60 * 1000)
      )
      for
        _ <- logTech(s"New threads since last check: ${newThreads.size}")
        _ <- logTech(s"Disappeared threads since last check: ${disappearedThreads.size}")
        _ <- logTech(s"Threads created in last 5 minutes: $last5Min")
        _ <- logTech(s"Threads created in last 30 minutes: $last30Min")
        _ <- logTech(s"Threads created in last hour: $lastHour")
        _ <- ZIO.when(newThreads.nonEmpty && newThreads.size < 10) {
               logTech("New thread names:") *>
                 ZIO.foreachDiscard(newThreads.toList.sorted) { name =>
                   logTech(s"  - $name")
                 }
             }
      yield ()
      end for
    else ZIO.unit


  // Analyze a specific thread group
  private def analyzeThreadGroup(groupName: String): ZIO[Any, Nothing, Unit] =
    ZIO.attempt {
      val threads = Thread.getAllStackTraces.keySet.asScala.toList
        .filter(t => Option(t.getThreadGroup).exists(_.getName == groupName))

      // Get detailed info for each thread
      val threadDetails = threads.map { thread =>
        val stackTrace   = thread.getStackTrace
        val stackSummary = if stackTrace.nonEmpty then stackTrace(0).toString else "No stack trace"
        (thread.getName, thread.getState, stackSummary)
      }

      threadDetails
    }.fold(
      _ => logTech(s"Failed to analyze thread group: $groupName"),
      details =>
        logTech(s"===== Thread Group: $groupName (${details.size} threads) =====") *>
          ZIO.foreachDiscard(details.sortBy(_._1)) { case (name, state, stack) =>
            logTech(s"Thread: $name, State: $state") *>
              logTech(s"  Stack: $stack")
          }
    )

  // Find threads by name pattern
  def findThreadsByPattern(pattern: String): ZIO[Any, Nothing, Unit] =
    ZIO.attempt {
      val threads = Thread.getAllStackTraces.keySet.asScala.toList
        .filter(_.getName.contains(pattern))

      // Get detailed info for each thread
      val threadDetails = threads.map { thread =>
        val stackTrace   = thread.getStackTrace
        val stackSummary = if stackTrace.nonEmpty then
          stackTrace.take(3).map(_.toString).mkString("\n    ")
        else
          "No stack trace"
        (thread.getName, thread.getState, stackSummary)
      }

      threadDetails
    }.fold(
      _ => logTech(s"Failed to find threads matching pattern: $pattern"),
      details =>
        logTech(s"===== Threads matching '$pattern' (${details.size} threads) =====") *>
          ZIO.foreachDiscard(details.sortBy(_._1)) { case (name, state, stack) =>
            logTech(s"Thread: $name, State: $state") *>
              logTech(s"  Stack: $stack")
          }
    )
end ThreadMonitor
