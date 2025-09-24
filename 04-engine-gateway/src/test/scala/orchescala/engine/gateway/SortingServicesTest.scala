package orchescala.engine.gateway

import munit.FunSuite
import orchescala.engine.domain.EngineType
import orchescala.engine.services.EngineService

class SortingServicesTest extends FunSuite:

  // Mock service implementation for testing
  case class MockEngineService(name: String, engineType: EngineType) extends EngineService

  test("sortedFromCache with no cache key returns original order"):
    val services = Seq(
      MockEngineService("service1", EngineType.C7),
      MockEngineService("service2", EngineType.C8),
      MockEngineService("service3", EngineType.C7)
    )
    val result = services.sortedFromCache(None)
    assertEquals(result, services)

  test("sortedFromCache with cache key but no cache entries returns original order"):
    EngineCache.invalidateAll()
    val services = Seq(
      MockEngineService("service1", EngineType.C7),
      MockEngineService("service2", EngineType.C8)
    )
    val result = services.sortedFromCache(Some("test-key"))
    assertEquals(result, services)

  test("sortedFromCache with cache key sorts matching engine types first"):
    EngineCache.invalidateAll()
    EngineCache.updateCache("cache-key", EngineType.C8)
    
    val services = Seq(
      MockEngineService("service1", EngineType.C7),
      MockEngineService("service2", EngineType.C8),
      MockEngineService("service3", EngineType.C7)
    )
    
    val result = services.sortedFromCache(Some("cache-key"))
    
    // Service with matching engine type (C8) should come first
    assertEquals(result.head.engineType, EngineType.C8)
    assertEquals(result.head.name, "service2")

  test("sortedFromCache with UUID key prioritizes C8 services"):
    EngineCache.invalidateAll()
    val uuidKey = "550e8400-e29b-41d4-a716-446655440000"

    val services = Seq(
      MockEngineService("service1", EngineType.C7),
      MockEngineService("service2", EngineType.C8),
      MockEngineService("service3", EngineType.C7)
    )

    val result = services.sortedFromCache(Some(uuidKey))

    // C8 service should come first for UUID keys
    assertEquals(result.head.engineType, EngineType.C8)
    assertEquals(result.head.name, "service2")

  test("sortedFromCache with Long key prioritizes C7 services"):
    EngineCache.invalidateAll()
    val longKey = "12345"

    val services = Seq(
      MockEngineService("service1", EngineType.C8),
      MockEngineService("service2", EngineType.C7),
      MockEngineService("service3", EngineType.C8)
    )

    val result = services.sortedFromCache(Some(longKey))

    // C7 service should come first for Long keys
    assertEquals(result.head.engineType, EngineType.C7)
    assertEquals(result.head.name, "service2")

  test("sortedFromCache with invalid key defaults to the order in the list"):
    EngineCache.invalidateAll()
    val invalidKey = "not-uuid-or-long"

    val services = Seq(
      MockEngineService("service1", EngineType.C8),
      MockEngineService("service2", EngineType.C7),
      MockEngineService("service3", EngineType.C8)
    )

    val result = services.sortedFromCache(Some(invalidKey))

    // C7 service should come first as default
    assertEquals(result.head.engineType, EngineType.C8)
    assertEquals(result.head.name, "service1")
