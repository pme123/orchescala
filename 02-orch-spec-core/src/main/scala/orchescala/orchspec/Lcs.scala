package orchescala.orchspec

import scala.annotation.tailrec

/** The longest common subsequence of two lists - the pairs of indexes that stay. On a tie it skips in
  * `a` first, exactly like `lcs` in orch-spec (`src/util.ts`), so both find the same pairs.
  */
object Lcs:

  def apply(a: IndexedSeq[String], b: IndexedSeq[String]): Vector[(Int, Int)] =
    // rows(i)(j): the length of the common subsequence of a.drop(i) and b.drop(j) - each row an
    // Array[Int] (no boxing), built from the right with scanRight, never changed afterwards
    val table = a.indices.foldRight(List(Array.fill(b.length + 1)(0))): (i, below) =>
      val next = below.head
      val row  = b.indices.toArray.scanRight(0): (j, right) =>
        if a(i) == b(j) then 1 + next(j + 1) else math.max(next(j), right)
      row :: below
    val rows = table.toVector

    @tailrec
    def walk(i: Int, j: Int, pairs: Vector[(Int, Int)]): Vector[(Int, Int)] =
      if i >= a.length || j >= b.length then pairs
      else if a(i) == b(j) then walk(i + 1, j + 1, pairs :+ (i -> j))
      else if rows(i + 1)(j) >= rows(i)(j + 1) then walk(i + 1, j, pairs)
      else walk(i, j + 1, pairs)

    walk(0, 0, Vector.empty)
  end apply

end Lcs
