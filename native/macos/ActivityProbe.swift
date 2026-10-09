// bubu activity probe for macOS 14.2+ (ARCHITECTURE「活动镜像」).
//
// Prints one JSON line every two seconds and nothing else:
//   {"v":1,"front":"<bundle id or null>","audio":["<bundle id>", ...]}
// - front: NSWorkspace's frontmost application. No permission is required.
// - audio: Core Audio process objects that are currently running output
//   (kAudioHardwarePropertyProcessObjectList + kAudioProcessPropertyIsRunningOutput).
//   No microphone, screen recording or accessibility permission is required.
// It never reads window titles, track names or audio content, and exits when its
// parent closes stdin.
import AppKit
import CoreAudio
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector,
                               mScope: kAudioObjectPropertyScopeGlobal,
                               mElement: kAudioObjectPropertyElementMain)
}

func processObjects() -> [AudioObjectID] {
    var request = address(kAudioHardwarePropertyProcessObjectList)
    var size: UInt32 = 0
    let system = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(system, &request, 0, nil, &size) == noErr, size > 0 else { return [] }
    var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(system, &request, 0, nil, &size, &objects) == noErr else { return [] }
    return objects
}

func isRunningOutput(_ object: AudioObjectID) -> Bool {
    var request = address(kAudioProcessPropertyIsRunningOutput)
    var running: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(object, &request, 0, nil, &size, &running) == noErr && running != 0
}

func bundleIdentifier(_ object: AudioObjectID) -> String? {
    var request = address(kAudioProcessPropertyBundleID)
    var value: Unmanaged<CFString>? = nil
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    if AudioObjectGetPropertyData(object, &request, 0, nil, &size, &value) == noErr,
       let bundle = value?.takeRetainedValue() as String?, !bundle.isEmpty {
        return bundle
    }
    var pidRequest = address(kAudioProcessPropertyPID)
    var pid: pid_t = 0
    var pidSize = UInt32(MemoryLayout<pid_t>.size)
    guard AudioObjectGetPropertyData(object, &pidRequest, 0, nil, &pidSize, &pid) == noErr, pid > 0 else { return nil }
    return NSRunningApplication(processIdentifier: pid)?.bundleIdentifier
}

func audibleBundles() -> [String] {
    var seen = Set<String>()
    var result: [String] = []
    for object in processObjects() where isRunningOutput(object) {
        guard let bundle = bundleIdentifier(object), bundle.count <= 200, !seen.contains(bundle) else { continue }
        seen.insert(bundle)
        result.append(bundle)
        if result.count >= 32 { break }
    }
    return result
}

func emit() {
    let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
    let line: [String: Any] = ["v": 1, "front": front.map { $0 as Any } ?? NSNull(), "audio": audibleBundles()]
    guard let data = try? JSONSerialization.data(withJSONObject: line),
          let text = String(data: data, encoding: .utf8) else { return }
    print(text)
}

// Exit when the parent goes away.
Thread.detachNewThread {
    while readLine(strippingNewline: true) != nil {}
    exit(0)
}

// A prohibited NSApplication keeps NSWorkspace's frontmost application current
// without a Dock icon, a menu bar or focus.
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
emit()
Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in emit() }
application.run()
