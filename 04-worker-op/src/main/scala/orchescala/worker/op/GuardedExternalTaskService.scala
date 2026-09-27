package orchescala.worker.op

import org.operaton.bpm.client.task.{ExternalTask, ExternalTaskService}

import java.util.Map as JMap

/** The ExternalTaskService of ONE task, as its job and its lock renewal share it.
  *
  * The engine rejects a lock extension and a completion of the same task that overlap (optimistic
  * locking: "Entity was updated by another transaction concurrently") - so all calls run one
  * after the other, and once the task is completed / failed / unlocked it is not extended anymore.
  */
final class GuardedExternalTaskService(delegate: ExternalTaskService) extends ExternalTaskService:

  @volatile private var finished = false

  private def finishing[A](call: => A): A =
    synchronized:
      finished = true
      call

  def extendLock(externalTask: ExternalTask, newDuration: Long): Unit =
    synchronized:
      if !finished then delegate.extendLock(externalTask, newDuration)
  def extendLock(externalTaskId: String, newDuration: Long): Unit =
    synchronized:
      if !finished then delegate.extendLock(externalTaskId, newDuration)

  def unlock(externalTask: ExternalTask): Unit = finishing(delegate.unlock(externalTask))

  def complete(externalTask: ExternalTask): Unit = finishing(delegate.complete(externalTask))
  def complete(externalTask: ExternalTask, variables: JMap[String, Object]): Unit =
    finishing(delegate.complete(externalTask, variables))
  def complete(
      externalTask: ExternalTask,
      variables: JMap[String, Object],
      localVariables: JMap[String, Object]
  ): Unit = finishing(delegate.complete(externalTask, variables, localVariables))
  def complete(
      externalTaskId: String,
      variables: JMap[String, Object],
      localVariables: JMap[String, Object]
  ): Unit = finishing(delegate.complete(externalTaskId, variables, localVariables))

  def handleFailure(
      externalTask: ExternalTask,
      errorMessage: String,
      errorDetails: String,
      retries: Int,
      retryTimeout: Long
  ): Unit = finishing(delegate.handleFailure(externalTask, errorMessage, errorDetails, retries, retryTimeout))
  def handleFailure(
      externalTaskId: String,
      errorMessage: String,
      errorDetails: String,
      retries: Int,
      retryTimeout: Long
  ): Unit = finishing(delegate.handleFailure(externalTaskId, errorMessage, errorDetails, retries, retryTimeout))
  def handleFailure(
      externalTaskId: String,
      errorMessage: String,
      errorDetails: String,
      retries: Int,
      retryDuration: Long,
      variables: JMap[String, Object],
      localVariables: JMap[String, Object]
  ): Unit = finishing(
    delegate.handleFailure(externalTaskId, errorMessage, errorDetails, retries, retryDuration, variables, localVariables)
  )

  def handleBpmnError(externalTask: ExternalTask, errorCode: String): Unit =
    finishing(delegate.handleBpmnError(externalTask, errorCode))
  def handleBpmnError(externalTask: ExternalTask, errorCode: String, errorMessage: String): Unit =
    finishing(delegate.handleBpmnError(externalTask, errorCode, errorMessage))
  def handleBpmnError(
      externalTask: ExternalTask,
      errorCode: String,
      errorMessage: String,
      variables: JMap[String, Object]
  ): Unit = finishing(delegate.handleBpmnError(externalTask, errorCode, errorMessage, variables))
  def handleBpmnError(
      externalTaskId: String,
      errorCode: String,
      errorMessage: String,
      variables: JMap[String, Object]
  ): Unit = finishing(delegate.handleBpmnError(externalTaskId, errorCode, errorMessage, variables))

  // neither finishes the task
  def lock(externalTaskId: String, lockDuration: Long): Unit =
    synchronized(delegate.lock(externalTaskId, lockDuration))
  def lock(externalTask: ExternalTask, lockDuration: Long): Unit =
    synchronized(delegate.lock(externalTask, lockDuration))
  def setVariables(processInstanceId: String, variables: JMap[String, Object]): Unit =
    synchronized(delegate.setVariables(processInstanceId, variables))
  def setVariables(externalTask: ExternalTask, variables: JMap[String, Object]): Unit =
    synchronized(delegate.setVariables(externalTask, variables))

end GuardedExternalTaskService
