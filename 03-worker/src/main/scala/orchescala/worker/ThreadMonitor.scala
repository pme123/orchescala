package orchescala.worker

import zio.*
import zio.Duration.{*, given}
import zio.ZIO.logDebug
import java.lang.management.*
import scala.jdk.CollectionConverters.*
import java.lang.Thread.State
import java.util.Date
import java.util.concurrent.ConcurrentHashMap
import scala.collection.mutable

object ThreadMonitor:

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
      "AsyncHttpClient"   -> "AsyncHTTP Client",
      "async-http-client"   -> "async-http-client",
      "sttp-"             -> "STTP Client"
    )

    val threadsByPattern = mutable.Map.empty[String, List[Thread]]
    threads.foreach { thread =>
      val name     = thread.getName
      val matched  = threadPatterns.keys.find(pattern => name.contains(pattern))
      val category = matched.flatMap(threadPatterns.get).getOrElse(name)
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
      _ <- logDebug("===== Thread Analysis =====")
      _ <- logDebug(s"Total Threads: ${Thread.activeCount()}")

      // Log threads by group
      _ <- logDebug("--- Threads by Group ---")
      _ <- ZIO.foreachDiscard(threadsByGroup.toList.sortBy(-_._2.size)) {
             case (group, threads) =>
               logDebug(s"Group '$group': ${threads.size} threads")
           }

      // Log threads by state
      _ <- logDebug("--- Threads by State ---")
      _ <- ZIO.foreachDiscard(threadsByState.toList) { case (state, threads) =>
             logDebug(s"$state: ${threads.size} threads")
           }

      // Log threads by pattern
      _ <- logDebug("--- Threads by Category ---")
      _ <- ZIO.foreachDiscard(threadsByPattern.toList.sortBy(-_._2.size)) {
             case (pattern, threads) =>
               logDebug(s"-- $pattern: ${threads.size} threads")
           }

      // Log blocked threads and their blocking points
      _   <- logDebug("--- Top Blocking Points ---")
      res <-
        ZIO.foreach(blockingPoints):
          case (point, count) =>
            ZIO.succeed(s"$count threads blocked at: $point")
      _   <- logDebug(res.mkString("\n", "\n", ""))

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
      val last10Min  = currentThreads.count(t =>
        Option(threadCreationHistory.get(t.getName)).exists(time => now - time < 10 * 60 * 1000)
      )
      for
        _ <- logDebug(s"New threads since last check: ${newThreads.size}")
        _ <- logDebug(s"Disappeared threads since last check: ${disappearedThreads.size}")
        _ <- logDebug(s"Threads created in last 10 minutes: $last10Min")
        _ <- logDebug("New thread names:") *>
                 ZIO.foreachDiscard(newThreads.toList.sorted) { name =>
                   logDebug(s"  - $name")
                 }
        _ <- logDebug("Disappeared thread names:") *>
                 ZIO.foreachDiscard(disappearedThreads.toList.sorted) { name =>
                   logDebug(s"  - $name")
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
      _ => logDebug(s"Failed to analyze thread group: $groupName"),
      details =>
        logDebug(s"===== Thread Group: $groupName (${details.size} threads) =====") *>
          ZIO.foreachDiscard(details.sortBy(_._1)) { case (name, state, stack) =>
            logDebug(s"Thread: $name, State: $state") *>
              logDebug(s"  Stack: $stack")
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
      _ => logDebug(s"Failed to find threads matching pattern: $pattern"),
      details =>
        logDebug(s"===== Threads matching '$pattern' (${details.size} threads) =====") *>
          ZIO.foreachDiscard(details.sortBy(_._1)) { case (name, state, stack) =>
            logDebug(s"Thread: $name, State: $state") *>
              logDebug(s"  Stack: $stack")
          }
    )
end ThreadMonitor
