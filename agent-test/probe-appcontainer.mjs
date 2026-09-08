/** Test-only Win32 feasibility probe for Crew's required read and network isolation. */
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, createServer } from 'node:net'

if (process.platform !== 'win32') throw new Error('This probe requires Windows')
const require = createRequire(new URL('../packages/sandbox/sandbox-windows-acl/package.json', import.meta.url))
const koffi = require('koffi')
const kernel = koffi.load('kernel32.dll')
const userenv = koffi.load('userenv.dll')
const advapi = koffi.load('advapi32.dll')
const kernelbase = koffi.load('kernelbase.dll')
const bind = (dll, name, result, args) => dll.func('__stdcall', name, result, args)
const createProfile = bind(userenv, 'CreateAppContainerProfile', 'int32', ['str16', 'str16', 'str16', 'void *', 'uint32', 'void *'])
const deleteProfile = bind(userenv, 'DeleteAppContainerProfile', 'int32', ['str16'])
const freeSid = bind(advapi, 'FreeSid', 'void *', ['void *'])
const deriveCapability = bind(kernelbase, 'DeriveCapabilitySidsFromName', 'int', ['str16', 'void *', 'void *', 'void *', 'void *'])
const initialize = bind(kernel, 'InitializeProcThreadAttributeList', 'int', ['void *', 'uint32', 'uint32', 'void *'])
const update = bind(kernel, 'UpdateProcThreadAttribute', 'int', ['void *', 'uint32', 'size_t', 'void *', 'size_t', 'void *', 'void *'])
const deleteAttributes = bind(kernel, 'DeleteProcThreadAttributeList', 'void', ['void *'])
const create = bind(kernel, 'CreateProcessW', 'int', ['str16', 'void *', 'void *', 'void *', 'int', 'uint32', 'void *', 'str16', 'void *', 'void *'])
const lastError = bind(kernel, 'GetLastError', 'uint32', [])
const resume = bind(kernel, 'ResumeThread', 'uint32', ['void *'])
const wait = bind(kernel, 'WaitForSingleObject', 'uint32', ['void *', 'uint32'])
const exitCode = bind(kernel, 'GetExitCodeProcess', 'int', ['void *', 'void *'])
const terminate = bind(kernel, 'TerminateProcess', 'int', ['void *', 'uint32'])
const close = bind(kernel, 'CloseHandle', 'int', ['void *'])
const getSecurity = bind(advapi, 'GetNamedSecurityInfoW', 'uint32', ['str16', 'uint32', 'uint32', 'void *', 'void *', 'void *', 'void *', 'void *'])
const setSecurity = bind(advapi, 'SetNamedSecurityInfoW', 'uint32', ['str16', 'uint32', 'uint32', 'void *', 'void *', 'void *', 'void *'])
const setAcl = bind(advapi, 'SetEntriesInAclW', 'uint32', ['uint32', 'void *', 'void *', 'void *'])
const localFree = bind(kernel, 'LocalFree', 'void *', ['void *'])
const createFile = bind(kernel, 'CreateFileW', 'void *', ['str16', 'uint32', 'uint32', 'void *', 'uint32', 'uint32', 'void *'])
const createPipe = bind(kernel, 'CreatePipe', 'int', ['void *', 'void *', 'void *', 'uint32'])
const setHandleInformation = bind(kernel, 'SetHandleInformation', 'int', ['void *', 'uint32', 'uint32'])
const peekPipe = bind(kernel, 'PeekNamedPipe', 'int', ['void *', 'void *', 'uint32', 'void *', 'void *', 'void *'])
const readPipe = bind(kernel, 'ReadFile', 'int', ['void *', 'void *', 'uint32', 'void *', 'void *'])
const securityAttributes = koffi.struct('CREW_PROBE_SECURITY_ATTRIBUTES', {
  size: 'uint32', descriptor: 'void *', inherit: 'int',
})
const trustee = koffi.struct('CREW_PROBE_TRUSTEE', {
  multiple: 'void *', operation: 'uint32', form: 'uint32', type: 'uint32', name: 'void *',
})
const aceType = koffi.struct('CREW_PROBE_EXPLICIT_ACCESS', {
  permissions: 'uint32', mode: 'uint32', inheritance: 'uint32', trustee,
})
const startup = koffi.struct('CREW_PROBE_STARTUPINFO', {
  cb: 'uint32', lpReserved: 'void *', lpDesktop: 'void *', lpTitle: 'void *',
  dwX: 'uint32', dwY: 'uint32', dwXSize: 'uint32', dwYSize: 'uint32',
  dwXCountChars: 'uint32', dwYCountChars: 'uint32', dwFillAttribute: 'uint32',
  dwFlags: 'uint32', wShowWindow: 'uint16', cbReserved2: 'uint16', lpReserved2: 'void *',
  hStdInput: 'void *', hStdOutput: 'void *', hStdError: 'void *',
})
const extended = koffi.struct('CREW_PROBE_STARTUPINFOEX', { startup, attributes: 'void *' })
const security = koffi.struct('CREW_PROBE_SECURITY_CAPABILITIES', {
  sid: 'void *', capabilities: 'void *', count: 'uint32', reserved: 'uint32',
})
const sidAttributes = koffi.struct('CREW_PROBE_SID_ATTRIBUTES', { sid: 'void *', attributes: 'uint32' })
const infoType = koffi.struct('CREW_PROBE_PROCESS_INFORMATION', {
  process: 'void *', thread: 'void *', pid: 'uint32', tid: 'uint32',
})
const allocated = []
const localAllocations = []
const alloc = (type, count = 1) => { const value = koffi.alloc(type, count); allocated.push(value); return value }
const check = (ok, name) => { if (!ok) throw new Error(`${name}: Win32 ${lastError()}`) }
let sid
let attributes
let info
let profile
const handles = []
const fixture = mkdtempSync(join(tmpdir(), 'dsh-crew-appcontainer-'))
const source = join(fixture, 'src')
mkdirSync(source)
writeFileSync(join(fixture, '.env'), 'fixture-only canary\n')
writeFileSync(join(fixture, 'adjacent.txt'), 'unchanged\n')
const server = createServer(socket => socket.destroy())
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('error', reject)
    socket.once('connect', () => { socket.destroy(); resolve() })
  })
  const slot = alloc('void *')
  const name = `dsh-crew-probe-${randomUUID()}`
  const hr = createProfile(name, name, 'Temporary Crew isolation probe', null, 0, slot)
  if (hr < 0) throw new Error(`CreateAppContainerProfile: HRESULT ${hr}`)
  profile = name
  sid = koffi.decode(slot, 'void *')
  const grant = (path, permissions, inheritance) => {
    const oldAcl = alloc('void *')
    const descriptor = alloc('void *')
    const newAcl = alloc('void *')
    const code = getSecurity(path, 1, 4, null, null, oldAcl, null, descriptor)
    if (code !== 0) throw new Error(`GetNamedSecurityInfoW: ${code}`)
    const entry = alloc(aceType)
    try {
      koffi.encode(entry, aceType, { permissions, mode: 1, inheritance, trustee: { form: 0, type: 1, name: sid } })
      const aclCode = setAcl(1, entry, koffi.decode(oldAcl, 'void *'), newAcl)
      if (aclCode !== 0) throw new Error(`SetEntriesInAclW: ${aclCode}`)
      const setCode = setSecurity(path, 1, 4, null, null, koffi.decode(newAcl, 'void *'), null)
      if (setCode !== 0) throw new Error(`SetNamedSecurityInfoW: ${setCode}`)
    } finally {
      localFree(koffi.decode(newAcl, 'void *'))
      localFree(koffi.decode(descriptor, 'void *'))
    }
  }
  grant(fixture, 0x1000A0, 0)
  grant(source, 0x1301BF, 3)
  const executable = join(source, 'node.exe')
  copyFileSync(process.execPath, executable)
  const resultFile = join(source, 'result.json')
  const scriptFile = join(source, 'probe.mjs')
  writeFileSync(scriptFile, [
    "import { readFileSync, writeFileSync } from 'node:fs'",
    "import { connect } from 'node:net'",
    'const result = {}',
    `try { readFileSync(${JSON.stringify(join(fixture, '.env'))}); result.read = 'allowed' } catch (error) { result.read = error.code }`,
    `try { writeFileSync(${JSON.stringify(join(fixture, 'adjacent.txt'))}, 'escaped'); result.write = 'allowed' } catch (error) { result.write = error.code }`,
    `result.network = await new Promise(resolve => { const socket = connect({ host: '127.0.0.1', port: ${port} }); socket.once('error', error => resolve(error.code)); socket.once('connect', () => { socket.destroy(); resolve('allowed') }); socket.setTimeout(2000, () => { socket.destroy(); resolve('timeout') }) })`,
    `writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify(result))`,
  ].join('\n'))
  const size = alloc('size_t')
  initialize(null, 2, 0, size)
  const list = alloc('uint8', Number(koffi.decode(size, 'size_t')))
  check(initialize(list, 2, 0, size), 'InitializeProcThreadAttributeList')
  attributes = list
  const caps = alloc(security)
  const groupsSlot = alloc('void *')
  const groupCountSlot = alloc('uint32')
  const capabilitiesSlot = alloc('void *')
  const capabilityCountSlot = alloc('uint32')
  check(deriveCapability('registryRead', groupsSlot, groupCountSlot, capabilitiesSlot, capabilityCountSlot), 'DeriveCapabilitySidsFromName')
  let registryCapability
  for (const [arraySlot, countSlot] of [[groupsSlot, groupCountSlot], [capabilitiesSlot, capabilityCountSlot]]) {
    const array = koffi.decode(arraySlot, 'void *')
    localAllocations.push(array)
    const pointers = koffi.decode(array, 'void *', koffi.decode(countSlot, 'uint32'))
    localAllocations.push(...pointers)
    if (arraySlot === capabilitiesSlot) registryCapability = pointers[0]
  }
  const capList = alloc(sidAttributes)
  koffi.encode(capList, sidAttributes, { sid: registryCapability, attributes: 4 })
  koffi.encode(caps, security, { sid, capabilities: capList, count: 1, reserved: 0 })
  check(update(attributes, 0, 0x20009, caps, security.size, null, null), 'UpdateProcThreadAttribute')
  const leastPrivilege = alloc('uint32')
  koffi.encode(leastPrivilege, 'uint32', 1)
  check(update(attributes, 0, 0x2000F, leastPrivilege, 4, null, null), 'UpdateProcThreadAttribute LPAC')
  const si = alloc(extended)
  const handleAttributes = alloc(securityAttributes)
  koffi.encode(handleAttributes, securityAttributes, { size: securityAttributes.size, descriptor: null, inherit: 1 })
  const open = (path, access, creation) => {
    const handle = createFile(path, access, 3, handleAttributes, creation, 0x80, null)
    check(handle !== null && handle !== 0xFFFFFFFFFFFFFFFFn && handle !== -1n, 'CreateFileW')
    handles.push(handle)
    return handle
  }
  const pipe = () => {
    const read = alloc('void *')
    const write = alloc('void *')
    check(createPipe(read, write, handleAttributes, 0), 'CreatePipe')
    const pair = { read: koffi.decode(read, 'void *'), write: koffi.decode(write, 'void *') }
    handles.push(pair.read, pair.write)
    check(setHandleInformation(pair.read, 1, 0), 'SetHandleInformation')
    return pair
  }
  const stdout = pipe()
  const stderr = pipe()
  koffi.encode(si, extended, { startup: {
    cb: extended.size, dwFlags: 0x100,
    hStdInput: open('NUL', 0x80000000, 3),
    hStdOutput: stdout.write,
    hStdError: stderr.write,
  }, attributes })
  const pi = alloc(infoType)
  const line = Buffer.from(`"${executable}" --preserve-symlinks --preserve-symlinks-main "${scriptFile}"\0`, 'utf16le')
  const environmentKeys = ['SystemRoot', 'SystemDrive', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'ProgramFiles', 'ProgramData', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec']
  const entries = environmentKeys.flatMap(key => process.env[key] === undefined ? [] : [`${key}=${process.env[key]}`])
  const env = Buffer.from(`${entries.sort().join('\0')}\0\0`, 'utf16le')
  check(create(executable, line, null, null, 1, 0x08080404, env, fixture, si, pi), 'CreateProcessW')
  info = koffi.decode(pi, infoType)
  check(resume(info.thread) !== 0xFFFFFFFF, 'ResumeThread')
  for (const stream of [stdout, stderr]) {
    close(stream.write)
    handles.splice(handles.indexOf(stream.write), 1)
  }
  const captured = new Map([[stdout, ''], [stderr, '']])
  const available = alloc('uint32')
  const deadline = Date.now() + 10_000
  while (true) {
    for (const stream of [stdout, stderr]) {
      if (peekPipe(stream.read, null, 0, null, available, null) && koffi.decode(available, 'uint32') > 0) {
        const bytes = Buffer.alloc(koffi.decode(available, 'uint32'))
        check(readPipe(stream.read, bytes, bytes.length, available, null), 'ReadFile')
        captured.set(stream, captured.get(stream) + bytes.subarray(0, koffi.decode(available, 'uint32')).toString())
      }
    }
    if (wait(info.process, 0) === 0) break
    if (Date.now() > deadline) throw new Error('Confined process timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  const code = alloc('uint32')
  check(exitCode(info.process, code), 'GetExitCodeProcess')
  const actual = koffi.decode(code, 'uint32')
  if (actual !== 0) throw new Error(`Confined Node failed: ${actual}; ${captured.get(stderr)}`)
  const result = JSON.parse(readFileSync(resultFile, 'utf8'))
  console.log(JSON.stringify({ appContainerCreated: true, exitCode: actual, result }))
  if (!['EACCES', 'EPERM'].includes(result.read) || !['EACCES', 'EPERM'].includes(result.write)
    || !['EACCES', 'EPERM', 'ETIMEDOUT'].includes(result.network)) {
    throw new Error('AppContainer did not enforce every denied effect')
  }
  if (readFileSync(join(fixture, 'adjacent.txt'), 'utf8') !== 'unchanged\n') throw new Error('Adjacent canary changed')
} finally {
  if (info) {
    if (wait(info.process, 0) !== 0) { terminate(info.process, 1); wait(info.process, 10_000) }
    close(info.thread)
    close(info.process)
  }
  if (attributes) deleteAttributes(attributes)
  for (const handle of handles.reverse()) close(handle)
  if (sid) freeSid(sid)
  if (profile) {
    const hr = deleteProfile(profile)
    if (hr < 0) console.error(`DeleteAppContainerProfile: HRESULT ${hr}`)
  }
  for (const pointer of allocated.reverse()) koffi.free(pointer)
  for (const pointer of localAllocations.reverse()) localFree(pointer)
  await new Promise(resolve => server.close(resolve))
  rmSync(fixture, { recursive: true, force: true })
}
