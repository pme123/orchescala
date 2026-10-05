package orchescala.persistence

import orchescala.domain.InOutCodec

import java.time.Instant

/** How an entity is stored: the table, its id and the key fields that can be queried.
  *
  * The entity itself is stored as JSON (`payload`), the key fields additionally in `keys` (indexed),
  * so a query needs no SQL per entity:
  * {{{
  * val notiz = EntityDef[Notiz]("notiz", _.id, n => Map("kundenNr" -> n.kundenNr))
  * }}}
  *
  * @param table
  *   table name - lower case letters, digits and `_`, starting with a letter, at most 54
  *   characters, not ending with `_history` (the audit log of the table gets this suffix)
  */
case class EntityDef[E](
    table: String,
    id: E => String,
    keys: E => Map[String, String] = (_: E) => Map.empty[String, String]
)(using val codec: InOutCodec[E]):
  require(
    EntityDef.isValidTable(table),
    s"Invalid table name '$table' - use lower case letters, digits and '_', starting with a letter, at most 54 characters"
  )
  require(
    !table.endsWith("_history"),
    s"Invalid table name '$table' - '_history' is reserved for the audit log of a table"
  )
end EntityDef

object EntityDef:
  private[persistence] def isValidTable(table: String): Boolean =
    table.matches("[a-z][a-z0-9_]{0,53}")

/** An entity as it is stored - with version (optimistic locking) and audit fields. */
case class Stored[E](
    entity: E,
    id: String,
    version: Long,
    createdAt: Instant,
    createdBy: Option[String],
    updatedAt: Instant,
    updatedBy: Option[String]
)

enum Operation:
  case Created, Updated, Deleted

  def dbValue: String = toString.toLowerCase

object Operation:
  def fromDb(value: String): Operation =
    Operation.values.find(_.dbValue == value).getOrElse(
      throw IllegalArgumentException(s"Unknown operation '$value' in the history")
    )

/** An entry of the audit log: what the entity looked like after the change, who changed it when.
  * For [[Operation.Deleted]] it is the last state before the deletion.
  */
case class Change[E](
    id: String,
    version: Long,
    operation: Operation,
    entity: E,
    changedAt: Instant,
    changedBy: Option[String]
)

enum PersistenceError:
  case NotFound(table: String, id: String)

  /** The entity was changed (or created) by someone else - `expected` is the version the caller had,
    * `actual` the one in the store (None if it is gone).
    */
  case VersionConflict(table: String, id: String, expected: Option[Long], actual: Option[Long])
  case StoreError(msg: String)

  def message: String = this match
    case NotFound(table, id)                          => s"$table '$id' not found"
    case VersionConflict(table, id, None, _)          => s"$table '$id' already exists"
    case VersionConflict(table, id, Some(exp), None)  => s"$table '$id' (version $exp) no longer exists"
    case VersionConflict(table, id, Some(exp), Some(act)) =>
      s"$table '$id' was changed in the meantime (version $exp, now $act)"
    case StoreError(msg)                              => msg
end PersistenceError
