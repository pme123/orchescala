package orchescala.simulation

import scala.reflect.ClassTag

object DiffPrinter:
  def printDiff[T <: Product](expected: T, actual: T)(using ClassTag[T]): String =
    val className = summon[ClassTag[T]].runtimeClass.getSimpleName
    
    if expected == actual then
      s"No differences found between $className instances"
    else
      val fieldNames = expected.productElementNames.toSeq
      val expectedValues = expected.productIterator.toSeq
      val actualValues = actual.productIterator.toSeq
      
      val diffs = fieldNames.zip(expectedValues.zip(actualValues))
        .filter { case (_, (exp, act)) => exp != act }
        .map { case (fieldName, (exp, act)) =>
          s"""  - $fieldName:
             |    Expected: $exp
             |    Actual  : $act""".stripMargin
        }
        .mkString("\n")
      
      s"""Differences found in $className:
         |$diffs""".stripMargin
  
  // For nested case classes or collections
  def printDeepDiff[T <: Product](expected: T, actual: T)(using ClassTag[T]): String =
    val className = summon[ClassTag[T]].runtimeClass.getSimpleName
    
    if expected == actual then
      s"No differences found between $className instances"
    else
      val fieldNames = expected.productElementNames.toSeq
      val expectedValues = expected.productIterator.toSeq
      val actualValues = actual.productIterator.toSeq
      
      val diffs = fieldNames.zip(expectedValues.zip(actualValues))
        .flatMap { case (fieldName, (exp, act)) =>
          if exp == act then
            None
          else
            (exp, act) match
              case (e: Product, a: Product) if e.getClass == a.getClass =>
                // Use a helper method to handle the recursive call with proper type information
                Some(s"""  - $fieldName: (nested object)
                       |${printNestedDiff(e, a).split("\n").map("    " + _).mkString("\n")}""".stripMargin)
              case (e: Iterable[_], a: Iterable[_]) =>
                val eDiff = e.toSeq
                val aDiff = a.toSeq
                if eDiff.size != aDiff.size then
                  Some(s"""  - $fieldName: (collection)
                         |    Expected size: ${eDiff.size}
                         |    Actual size  : ${aDiff.size}""".stripMargin)
                else
                  val itemDiffs = eDiff.zip(aDiff).zipWithIndex
                    .filter { case ((e, a), _) => e != a }
                    .map { case ((e, a), idx) =>
                      (e, a) match
                        case (ep: Product, ap: Product) if ep.getClass == ap.getClass =>
                          s"""    [$idx]:
                             |${printNestedDiff(ep, ap).split("\n").map("      " + _).mkString("\n")}""".stripMargin
                        case _ =>
                          s"""    [$idx]:
                             |      Expected: $e
                             |      Actual  : $a""".stripMargin
                    }
                  if itemDiffs.isEmpty then None
                  else Some(s"""  - $fieldName: (collection)
                              |${itemDiffs.mkString("\n")}""".stripMargin)
              case _ =>
                Some(s"""  - $fieldName:
                       |    Expected: $exp
                       |    Actual  : $act""".stripMargin)
        }
        .mkString("\n")

      s"""Differences found in $className:
         |$diffs""".stripMargin

  // Helper method to handle nested product types with proper ClassTag
  private def printNestedDiff(expected: Product, actual: Product): String =
    // Get the common class to use for the ClassTag
    val commonClass = expected.getClass

    // Create a formatted diff using runtime reflection
    val className = commonClass.getSimpleName

    if expected == actual then
      s"No differences found between $className instances"
    else
      val fieldNames = expected.productElementNames.toSeq
      val expectedValues = expected.productIterator.toSeq
      val actualValues = actual.productIterator.toSeq

      val diffs = fieldNames.zip(expectedValues.zip(actualValues))
        .flatMap { case (fieldName, (exp, act)) =>
          if exp == act then
            None
          else
            (exp, act) match
              case (e: Product, a: Product) if e.getClass == a.getClass =>
                Some(s"""  - $fieldName: (nested object)
                       |${printDeepDiff(e, a).split("\n").map("    " + _).mkString("\n")}""".stripMargin)
              case (e: Iterable[_], a: Iterable[_]) =>
                val eDiff = e.toSeq
                val aDiff = a.toSeq
                if eDiff.size != aDiff.size then
                  Some(s"""  - $fieldName: (collection)
                         |    Expected size: ${eDiff.size}
                         |    Actual size  : ${aDiff.size}""".stripMargin)
                else
                  val itemDiffs = eDiff.zip(aDiff).zipWithIndex
                    .filter { case ((e, a), _) => e != a }
                    .map { case ((e, a), idx) =>
                      (e, a) match
                        case (ep: Product, ap: Product) if ep.getClass == ap.getClass =>
                          s"""    [$idx]:
                             |${printNestedDiff(ep, ap).split("\n").map("      " + _).mkString("\n")}""".stripMargin
                        case _ =>
                          s"""    [$idx]:
                             |      Expected: $e
                             |      Actual  : $a""".stripMargin
                    }
                  if itemDiffs.isEmpty then None
                  else Some(s"""  - $fieldName: (collection)
                              |${itemDiffs.mkString("\n")}""".stripMargin)
              case _ =>
                Some(s"""  - $fieldName:
                       |    Expected: $exp
                       |    Actual  : $act""".stripMargin)
        }
        .mkString("\n")
      
      s"""Differences found in $className:
         |$diffs""".stripMargin

  // Usage example:
  // val person1 = Person("John", 30, Address("123 Main St", "Anytown"))
  // val person2 = Person("John", 31, Address("123 Oak St", "Anytown"))
  // println(DiffPrinter.printDeepDiff(person1, person2))
end DiffPrinter