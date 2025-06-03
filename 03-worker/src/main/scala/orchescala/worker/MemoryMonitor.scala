package orchescala.worker

import zio.*
import zio.Duration.given
import zio.ZIO.logDebug

import java.lang.management.*
import scala.jdk.CollectionConverters.*

object MemoryMonitor:
  def start: ZIO[Any, Nothing, Unit] =
    // Get all garbage collector MX beans
    val gcBeans = ManagementFactory.getGarbageCollectorMXBeans.asScala.toList

    // Log initial GC information
    for
      _ <- logDebug("===== Garbage Collector Information =====")
      _ <-
        ZIO.foreachDiscard(gcBeans) {
          gc =>
            logDebug(
              s"GC: ${gc.getName}, Valid: ${gc.isValid}, Collection Count: ${gc.getCollectionCount}, Collection Time: ${gc.getCollectionTime}ms"
            )
        }
      _ <- logDebug("=" * 30)

      // Start periodic monitoring
      _ <- monitorMemory(gcBeans).fork

      // Start periodic forced GC if memory usage is high
      //_ <- forceGcWhenNeeded.fork
    yield ()
    end for
  end start

  private def logDetailedMemoryInfo: ZIO[Any, Nothing, Unit] =
    // Get memory pools information
    val memoryPools  = ManagementFactory.getMemoryPoolMXBeans.asScala.toList
    val nonHeapPools = memoryPools.filter(_.getType == MemoryType.NON_HEAP)
    val heapPools    = memoryPools.filter(_.getType == MemoryType.HEAP)

    // Get thread information
    val threadMXBean            = ManagementFactory.getThreadMXBean
    val threadCount             = threadMXBean.getThreadCount
    val peakThreadCount         = threadMXBean.getPeakThreadCount
    val totalStartedThreadCount = threadMXBean.getTotalStartedThreadCount

    // Calculate estimated thread stack memory
    // Assuming default stack size of 1MB per thread
    val estimatedThreadStackMemory = threadCount * 1 // MB

    // Get class loading information
    val classLoadingMXBean    = ManagementFactory.getClassLoadingMXBean
    val loadedClassCount      = classLoadingMXBean.getLoadedClassCount
    val totalLoadedClassCount = classLoadingMXBean.getTotalLoadedClassCount
    val unloadedClassCount    = classLoadingMXBean.getUnloadedClassCount

    // Calculate total non-heap memory
    var totalNonHeapUsed = 0L
    var totalNonHeapMax  = 0L

    for pool <- nonHeapPools do
      val usage = pool.getUsage
      if usage != null then
        totalNonHeapUsed += usage.getUsed
        if usage.getMax > 0 then // Some pools might report -1 for max
          totalNonHeapMax += usage.getMax
    end for

    val totalNonHeapUsedMB = totalNonHeapUsed / 1024 / 1024
    val totalNonHeapMaxMB  = if totalNonHeapMax > 0 then totalNonHeapMax / 1024 / 1024 else -1

    // Calculate total memory used by JVM
    val runtime            = java.lang.Runtime.getRuntime
    val maxHeap            = runtime.maxMemory() / 1024 / 1024
    val totalHeap          = runtime.totalMemory() / 1024 / 1024
    val freeHeap           = runtime.freeMemory() / 1024 / 1024
    val usedHeap           = totalHeap - freeHeap
    val totalJvmMemoryUsed = usedHeap + totalNonHeapUsedMB + estimatedThreadStackMemory

    // Log all memory information
    logDebug("===== Detailed Memory Information =====") *>
      logDebug(
        f"JVM Heap Memory: $usedHeap%d MB / $maxHeap%d MB (${usedHeap.toDouble / maxHeap.toDouble * 100}%.1f%%)"
      ) *>
      logDebug(f"Non-Heap Memory: $totalNonHeapUsedMB%d MB${
          if totalNonHeapMaxMB > 0 then f" / $totalNonHeapMaxMB%d MB" else ""
        }") *>
      logDebug(
        f"Thread Count: $threadCount (Peak: $peakThreadCount, Total Started: $totalStartedThreadCount)"
      ) *>
      logDebug(f"Estimated Thread Stack Memory: $estimatedThreadStackMemory MB") *>
      logDebug(
        f"Loaded Classes: $loadedClassCount (Total Loaded: $totalLoadedClassCount, Unloaded: $unloadedClassCount)"
      ) *>
      logDebug(f"Total Estimated JVM Memory: $totalJvmMemoryUsed MB") *>
      // Try to get process memory info if possible
      (ZIO
        .attempt:
          val processBean =
            ManagementFactory.getPlatformMXBean(classOf[com.sun.management.OperatingSystemMXBean])
          if processBean != null then
            val committedVirtualMemory = processBean.getCommittedVirtualMemorySize / 1024 / 1024
            val freeMemorySize         = processBean.getFreeMemorySize / 1024 / 1024
            val totalPhysicalMemory    = processBean.getTotalMemorySize / 1024 / 1024

            logDebug(f"Committed Virtual Memory: $committedVirtualMemory MB") *>
              logDebug(f"Free Physical Memory: $freeMemorySize MB") *>
              logDebug(f"Total Physical Memory: $totalPhysicalMemory MB")
          else
            logDebug("Process Memory: Not available")
          end if
        .flatten.catchAll(_ => logDebug("Process Memory: Not available"))) *>
      // Try to get direct buffer memory info
      ZIO.attempt {
        val server = ManagementFactory.getPlatformMBeanServer

        // Try to get direct buffer pool info
        try
          val bufferPoolMXBeans =
            ManagementFactory.getPlatformMXBeans(classOf[BufferPoolMXBean])
          ZIO.when(bufferPoolMXBeans != null && !bufferPoolMXBeans.isEmpty) {
            logDebug("--- Direct Buffer Memory ---") *>
              ZIO.foreach(bufferPoolMXBeans.asScala.toList) { bean =>
                val memoryUsed    = bean.getMemoryUsed / 1024 / 1024
                val totalCapacity = bean.getTotalCapacity / 1024 / 1024
                logDebug(
                  f"${bean.getName}: $memoryUsed MB / $totalCapacity MB (Count: ${bean.getCount})"
                )
              }
          }
        catch
          case _: Throwable => ZIO.unit
        end try
      }.flatten.ignore *>
      // Try to get JVM diagnostics
      ZIO.attempt {
        val server = ManagementFactory.getPlatformMBeanServer
        try
          val objectName =
            new javax.management.ObjectName("com.sun.management:type=DiagnosticCommand")
          val params     = Array("", "")
          val signature  = Array("java.lang.String", "java.lang.String")

          logDebug("--- JVM Native Memory Summary ---") *>
            ZIO.attempt {
              val result = server.invoke(
                objectName,
                "vmNativeMemory",
                Array("summary"),
                Array("java.lang.String")
              ).toString
              logDebug(result)
            }.catchAll(_ =>
              logDebug(
                "Native memory tracking not enabled. Use -XX:NativeMemoryTracking=summary"
              )
            )
        catch
          case _: Throwable => ZIO.unit
        end try
      }.flatten.ignore *>
      // Log memory pool details
      logDebug("--- Memory Pools ---") *>
      ZIO.foreachDiscard(memoryPools): pool =>
        val usage = pool.getUsage
        if usage != null then
          val used    = usage.getUsed / 1024 / 1024
          val max     = if usage.getMax > 0 then usage.getMax / 1024 / 1024 else -1
          val typeStr = if pool.getType == MemoryType.HEAP then "HEAP" else "NON-HEAP"
          logDebug(
            f"${pool.getName} ($typeStr): $used%d MB${if max > 0 then f" / $max%d MB" else ""}"
          )
        else
          logDebug(s"${pool.getName}: Usage not available")
        end if
  end logDetailedMemoryInfo

  private def monitorMemory(gcBeans: List[GarbageCollectorMXBean]): ZIO[Any, Nothing, Unit] =
    // Record previous collection counts to detect new collections
    var prevCounts = gcBeans.map(gc => gc.getName -> gc.getCollectionCount).toMap

    def checkGcActivity =
      for
        _ <- ThreadMonitor.analyzeThreads
        _ <- logDebug("===== GC Activity Check =====")
        _ <- ZIO.foreachDiscard(gcBeans) {
               gc =>
                 val currentCount   = gc.getCollectionCount
                 val prevCount      = prevCounts.getOrElse(gc.getName, 0L)
                 val newCollections = currentCount - prevCount

                 // Update previous count
                 prevCounts = prevCounts + (gc.getName -> currentCount)

                 logDebug(
                   s"GC: ${gc.getName}, New Collections: $newCollections, Total: $currentCount, Time: ${gc.getCollectionTime}ms"
                 )
             }

        // Log memory usage
        runtime      = java.lang.Runtime.getRuntime
        maxMemory    = runtime.maxMemory() / 1024 / 1024
        totalMemory  = runtime.totalMemory() / 1024 / 1024
        freeMemory   = runtime.freeMemory() / 1024 / 1024
        usedMemory   = totalMemory - freeMemory
        usagePercent = (usedMemory.toDouble / maxMemory.toDouble) * 100

        _ <- logDebug(f"Memory Usage: $usedMemory%d MB / $maxMemory%d MB ($usagePercent%.1f%%)")
        _ <- logDetailedMemoryInfo
        _ <- logDebug("===========================")
      yield ()

    // Check GC activity every 10 minutes using ZIO Schedule
    checkGcActivity.repeat(Schedule.fixed(10.minutes)).unit
  end monitorMemory

  private def forceGcWhenNeeded: ZIO[Any, Nothing, Unit] =
    def checkAndForceGc =
      val runtime      = java.lang.Runtime.getRuntime
      val maxMemory    = runtime.maxMemory()
      val totalMemory  = runtime.totalMemory()
      val freeMemory   = runtime.freeMemory()
      val usedMemory   = totalMemory - freeMemory
      val usagePercent = (usedMemory.toDouble / maxMemory.toDouble) * 100

      (ZIO.logWarning(f"Memory usage high ($usagePercent%.1f%%). Forcing garbage collection...") *>
        ZIO.attempt {
          java.lang.System.gc()
        }.ignore *>
        ZIO.sleep(1.second) *> // Give GC time to run
        ZIO.attempt {
          val newTotalMemory  = runtime.totalMemory()
          val newFreeMemory   = runtime.freeMemory()
          val newUsedMemory   = newTotalMemory - newFreeMemory
          val newUsagePercent = (newUsedMemory.toDouble / maxMemory.toDouble) * 100
          logDebug(
            f"After GC: Memory usage $newUsedMemory%d MB / $maxMemory%d MB ($newUsagePercent%.1f%%)"
          )
        }.ignore)
        .when(usagePercent > 75.0)
    end checkAndForceGc

    // Check memory usage and force GC if needed every 10 minutes using ZIO Schedule
    checkAndForceGc.repeat(Schedule.fixed(10.minutes)).unit
  end forceGcWhenNeeded
end MemoryMonitor
