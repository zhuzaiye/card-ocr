// localStorage baseline verification utility
// Non-functional feature: validates browser environment capabilities

interface BaselineCheckResult {
  passed: boolean
  checkName: string
  error?: string
  details?: Record<string, unknown>
}

interface BaselineReport {
  allPassed: boolean
  checks: BaselineCheckResult[]
  detectedCapacity?: number  // bytes; must exist when allPassed=true
  failedReason?: string
  fallbackGuidance?: {
    recommendedAction: 'proceed' | 'fallback_indexeddb' | 'abort'
    reason: string
    estimatedIndexedDBEffort?: string
  }
}

function checkWritable(): BaselineCheckResult {
  try {
    const testKey = '__ls_baseline_test__'
    const testValue = 'test_value_' + Date.now()
    localStorage.setItem(testKey, testValue)
    const retrieved = localStorage.getItem(testKey)
    localStorage.removeItem(testKey)

    if (retrieved !== testValue) {
      return { passed: false, checkName: 'writable', error: 'Read value mismatch' }
    }
    return { passed: true, checkName: 'writable' }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { passed: false, checkName: 'writable', error }
  }
}

function checkJSONSerialization(): BaselineCheckResult {
  try {
    const complex = {
      str: 'hello',
      num: 42,
      nested: { arr: [1, 2, 3] },
      date: new Date().toISOString()
    }
    const serialized = JSON.stringify(complex)
    const deserialized = JSON.parse(serialized)

    if (deserialized.str !== complex.str || deserialized.num !== complex.num) {
      return { passed: false, checkName: 'json', error: 'Deserialization mismatch' }
    }
    return { passed: true, checkName: 'json' }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { passed: false, checkName: 'json', error }
  }
}

function checkQuotaDetection(): BaselineCheckResult {
  const writtenKeys: string[] = []
  try {
    const testKey = '__ls_quota_test__'
    let written = 0
    const chunkSize = 100 * 1024  // 100KB per chunk
    const chunk = 'x'.repeat(chunkSize)

    // Write until QuotaExceededError (limit to 5MB to avoid browser warnings)
    while (written < 5 * 1024 * 1024) {  // max 5MB
      const key = testKey + written
      try {
        localStorage.setItem(key, chunk)
        writtenKeys.push(key)
        written += chunkSize
      } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          break
        }
        throw e
      }
    }

    return {
      passed: true,
      checkName: 'quota',
      details: { detectedCapacity: written }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { passed: false, checkName: 'quota', error }
  } finally {
    // Guaranteed cleanup: remove all test keys even on failure
    writtenKeys.forEach(key => {
      try {
        localStorage.removeItem(key)
      } catch {
        // Ignore cleanup errors
      }
    })
  }
}

function checkKeyEnumeration(): BaselineCheckResult {
  const testKeys = ['__test_1__', '__test_2__', '__test_3__']
  try {
    testKeys.forEach(k => localStorage.setItem(k, 'value'))

    const foundKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && testKeys.includes(key)) {
        foundKeys.push(key)
      }
    }

    if (foundKeys.length !== testKeys.length) {
      return {
        passed: false,
        checkName: 'enumeration',
        error: `Found ${foundKeys.length} of ${testKeys.length} keys`
      }
    }
    return { passed: true, checkName: 'enumeration' }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { passed: false, checkName: 'enumeration', error }
  } finally {
    // Guaranteed cleanup: remove test keys even on failure
    testKeys.forEach(k => {
      try {
        localStorage.removeItem(k)
      } catch {
        // Ignore cleanup errors
      }
    })
  }
}

export function verifyLocalStorageBaseline(): BaselineReport {
  const checks: BaselineCheckResult[] = []

  // Run checks sequentially, stop on first failure
  const writableResult = checkWritable()
  checks.push(writableResult)
  if (!writableResult.passed) {
    return {
      allPassed: false,
      checks,
      failedReason: `Check failed: writable - ${writableResult.error}`,
      fallbackGuidance: {
        recommendedAction: 'fallback_indexeddb',
        reason: 'localStorage is not writable (possibly private mode or disabled)',
        estimatedIndexedDBEffort: '2-3 features, 5-7 days'
      }
    }
  }

  const jsonResult = checkJSONSerialization()
  checks.push(jsonResult)
  if (!jsonResult.passed) {
    return {
      allPassed: false,
      checks,
      failedReason: `Check failed: json - ${jsonResult.error}`,
      fallbackGuidance: {
        recommendedAction: 'abort',
        reason: 'JSON serialization is broken, critical browser API unavailable'
      }
    }
  }

  const quotaResult = checkQuotaDetection()
  checks.push(quotaResult)
  if (!quotaResult.passed) {
    return {
      allPassed: false,
      checks,
      failedReason: `Check failed: quota - ${quotaResult.error}`,
      fallbackGuidance: {
        recommendedAction: 'proceed',
        reason: 'Quota detection failed but basic storage works, proceed with caution'
      }
    }
  }

  const enumerationResult = checkKeyEnumeration()
  checks.push(enumerationResult)
  if (!enumerationResult.passed) {
    return {
      allPassed: false,
      checks,
      failedReason: `Check failed: enumeration - ${enumerationResult.error}`,
      fallbackGuidance: {
        recommendedAction: 'fallback_indexeddb',
        reason: 'Key enumeration broken, history list functionality will fail'
      }
    }
  }

  // All checks passed
  const detectedCapacity = quotaResult.details?.detectedCapacity as number
  return {
    allPassed: true,
    checks,
    detectedCapacity
  }
}
