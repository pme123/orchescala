// ────────────────────────────────────────────────────────────────────────
// 01-domain/src/main/scala/valiant/addresschange/domain/kundenkontaktDokumentieren/v1/KundenkontaktDokumentieren.scala  (in die bestehende Datei einfügen)
// ────────────────────────────────────────────────────────────────────────

// oben in der Datei ergänzen:
// import io.github.iltotore.iron.*
// import io.github.iltotore.iron.constraint.all.*
// import valiant.graviton.domain.person.v1.GetCustomer
// import valiant.addresschange.customerContactNotesV1.CreateContactNote.domain.CreateContactNote.v1.CreateContactNote  // Pfad prüfen
// import valiant.graviton.domain.work.v1.PostWorkActivity

// in object KundenkontaktDokumentieren einfügen
// (InConfig und InitIn werden aus dem Ablauf erzeugt — nicht von Hand pflegen)

  case class In(
      @description("clientKeyDescr")
      customerId: Long,
      initiator: Option[Long],
      @description("The consultant Send to _${PostWorkActivity.topicName}_.")
      consultant: GravitonConsultant,
      sourceSystem: ProcessCallOrigin,
      responsibleUser: Option[Long],
      reconfirmation: Int,
      changeReceivedAt: String,
      receivedChannelAddressChange: Int :| any.In[( 1, 2, 3, 4, 5, 6, 7, 8 )],
      addressType: Int :| any.In[( 11, 15, 17, 21, 22, 24, 25, 26, 27, 28, 29, 31, 32, 34, 35, 36, 37, 38, 39, 41, 42, 44, 45, 46, 47, 48, 49, 51, 52, 54, 55, 56, 57, 58, 59, 61, 62, 64, 65, 66, 67, 68, 71, 81, 91, 93 )],
      address: AddressModifiable,
      shabNumber: Option[String]
  )

  object In:
    given ApiSchema[In]  = deriveApiSchema
    given InOutCodec[In] = deriveInOutCodec

    lazy val example = In(
      customerId = 1L,
      initiator = Some(1L),
      consultant = ???,
      sourceSystem = ???,
      responsibleUser = Some(1L),
      reconfirmation = 1,
      changeReceivedAt = "Beispiel",
      receivedChannelAddressChange = 1,
      addressType = 1,
      address = ???,
      shabNumber = Some("Beispiel")
    )
    lazy val exampleMinimal = example.copy(
      initiator = None,
      responsibleUser = None,
      shabNumber = None
    )
  end In

  case class InConfig(
      @description("Ergebnis von «Vorname/ Name von Initiator (Customer)» für Tests überschreiben.")
      vornameNamevonInitiatorCustomerMock: Option[GetCustomer.Out] = None,
      @description("Ergebnis von «Create Contact Note» für Tests überschreiben.")
      createContactNoteMock: Option[CreateContactNote.Out] = None,
      @description("Ergebnis von «Kundenkontakt dokumentieren (Post Activity)» für Tests überschreiben.")
      kundenkontaktdokumentierenPostActivityMock: Option[PostWorkActivity.Out] = None
  )

  object InConfig:
    given ApiSchema[InConfig]  = deriveApiSchema
    given InOutCodec[InConfig] = deriveInOutCodec
  end InConfig

  case class InitIn(
      noteTopic: Code = Code( id = Some("customerNoteTopic-1028"), recordOrigin = None, group = Some("customerNoteTopic"), number = Some("1028"), parentCodeId = None, addition = None, order = None, text = Some(CodeText( de = Some("Allgemein / nicht zuteilbar"), fr = Some("Général / non attribuable"), it = None, en = Some("Allgemein / nicht zuteilbar") )), textShort = Some(CodeTextShort( de = Some("Nicht"), fr = Some("Nicht"), it = None, en = Some("Nicht") )), tenant = None )
  )

  object InitIn:
    given ApiSchema[InitIn]  = deriveApiSchema
    given InOutCodec[InitIn] = deriveInOutCodec

    lazy val example = InitIn(
      noteTopic = ???
    )
    lazy val exampleMinimal = example
  end InitIn

// ────────────────────────────────────────────────────────────────────────
// 01-domain/src/main/scala/valiant/addresschange/domain/kundenkontaktDokumentieren/v1/CreateContactNote.scala
// ────────────────────────────────────────────────────────────────────────

package valiant.addresschange.domain.kundenkontaktDokumentieren.v1

/** Creates the contact note. */
object CreateContactNote extends CompanyBpmnCustomTaskDsl:

  val topicName = "valiant-addresschange-customerContactNotesV1-CreateContactNote"
  val descr = "Creates the contact note."

  case class In(
      addressType: Int :| any.In[( 11, 15, 17, 21, 22, 24, 25, 26, 27, 28, 29, 31, 32, 34, 35, 36, 37, 38, 39, 41, 42, 44, 45, 46, 47, 48, 49, 51, 52, 54, 55, 56, 57, 58, 59, 61, 62, 64, 65, 66, 67, 68, 71, 81, 91, 93 )],
      address: AddressModifiable,
      @description("clientKeyDescr")
      customerId: Long,
      changeReceivedAt: String,
      @description("A way to invalidate ignore the cache (set to true). Default is `false`.")
      ignoreCache: Boolean,
      @description("`customer.shortDesignation`")
      initiatorName: Option[String],
      @description("`customer.customerNumberAlternate`")
      initiatorKdnr: Option[String]
  )

  object In:
    given ApiSchema[In]  = deriveApiSchema
    given InOutCodec[In] = deriveInOutCodec

    lazy val example = In(
      addressType = 1,
      address = ???,
      customerId = 1L,
      changeReceivedAt = "Beispiel",
      ignoreCache = true,
      initiatorName = Some("Beispiel"),
      initiatorKdnr = Some("Beispiel")
    )
    lazy val exampleMinimal = example.copy(
      initiatorName = None,
      initiatorKdnr = None
    )
  end In

  case class Out(
      notePreTextDe: String,
      notePreTextFr: String,
      initiatorStrDe: String,
      initiatorStrFr: String,
      changeReceivedAtStr: String
  )

  object Out:
    given ApiSchema[Out]  = deriveApiSchema
    given InOutCodec[Out] = deriveInOutCodec

    lazy val example = Out(
      notePreTextDe = "Beispiel",
      notePreTextFr = "Beispiel",
      initiatorStrDe = "Beispiel",
      initiatorStrFr = "Beispiel",
      changeReceivedAtStr = "Beispiel"
    )
    lazy val exampleMinimal = example
  end Out

  lazy val example = customTask(
    In.example,
    Out.example
  )
end CreateContactNote
