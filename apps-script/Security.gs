function secureEquals_(left, right) {
  left = String(left || '');
  right = String(right || '');
  var mismatch = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var i = 0; i < length; i++) {
    mismatch |= (left.charCodeAt(i % Math.max(left.length, 1)) || 0)
      ^ (right.charCodeAt(i % Math.max(right.length, 1)) || 0);
  }
  return mismatch === 0;
}

function verifyGatewaySecret_(candidate) {
  var expected = PropertiesService.getScriptProperties().getProperty('GAS_SHARED_SECRET');
  if (!expected || !secureEquals_(candidate, expected)) throw new Error('REQUEST_REJECTED');
}

function requireSubject_(subject) {
  if (!subject || !subject.studentId || !subject.name) throw new Error('REQUEST_REJECTED');
  return {
    studentId: String(subject.studentId).trim(),
    name: String(subject.name).trim()
  };
}

// Production requests must not write student identifiers or health records to execution logs.
function safeLog_() {}
