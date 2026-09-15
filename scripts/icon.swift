// Turn a square logo PNG into the 1024×1024 macOS app-icon master:
// the artwork centred in Apple's icon tile (824×824 rounded square, radius
// 185, on a 1024 canvas with a soft shadow), the tile filled with the logo's
// own background colour, everything outside it transparent.
//
//   swiftc -O -o build/icon scripts/icon.swift
//   build/icon logo.PNG src-tauri/icons/source.png [fill]   fill = subject height / tile, default 0.70
//   npx tauri icon src-tauri/icons/source.png -o src-tauri/icons

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write("usage: icon <in.png> <out.png> [fill]\n".data(using: .utf8)!)
  exit(2)
}
let fill = args.count > 3 ? Double(args[3]) ?? 0.70 : 0.70

let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil)!
let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let w = img.width, h = img.height

// Subject = every pixel clearly darker than the paper; background = a corner pixel.
let scan = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
scan.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
let d = scan.data!.assumingMemoryBound(to: UInt8.self)
func px(_ x: Int, _ y: Int) -> (Int, Int, Int) { let i = ((h - 1 - y) * w + x) * 4; return (Int(d[i]), Int(d[i + 1]), Int(d[i + 2])) }
let bg = px(8, 8)
var x0 = w, x1 = 0, y0 = h, y1 = 0
for y in 0..<h {
  for x in 0..<w where (px(x, y).0 + px(x, y).1 + px(x, y).2) / 3 < 180 {
    x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y)
  }
}
let subject = CGRect(x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1)

let canvas = 1024.0, tile = 824.0, radius = 185.0
let inset = (canvas - tile) / 2
let tileRect = CGRect(x: inset, y: inset, width: tile, height: tile)
let path = CGPath(roundedRect: tileRect, cornerWidth: radius, cornerHeight: radius, transform: nil)

let out = CGContext(data: nil, width: Int(canvas), height: Int(canvas), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
out.interpolationQuality = .high

// Tile + shadow (Apple's template: black at ~30%, 10px down, 20px blur).
out.saveGState()
out.setShadow(offset: CGSize(width: 0, height: -10), blur: 20, color: CGColor(gray: 0, alpha: 0.3))
out.setFillColor(CGColor(red: CGFloat(bg.0) / 255, green: CGFloat(bg.1) / 255, blue: CGFloat(bg.2) / 255, alpha: 1))
out.addPath(path)
out.fillPath()
out.restoreGState()

// Artwork: scale so the subject's taller side is `fill` of the tile, centre it,
// draw the whole source (its paper covers the tile) clipped to the tile.
out.saveGState()
out.addPath(path)
out.clip()
let scale = fill * tile / Double(max(subject.width, subject.height))
let subjectCenter = CGPoint(x: subject.midX, y: Double(h) - subject.midY) // flip to CG coordinates
let origin = CGPoint(x: canvas / 2 - subjectCenter.x * scale, y: canvas / 2 - subjectCenter.y * scale)
out.draw(img, in: CGRect(x: origin.x, y: origin.y, width: Double(w) * scale, height: Double(h) * scale))
out.restoreGState()

let result = out.makeImage()!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, result, nil)
CGImageDestinationFinalize(dest)
print("subject \(Int(subject.width))x\(Int(subject.height)) at (\(Int(subject.midX)),\(Int(subject.midY))) → scale \(String(format: "%.3f", scale)), paper rgb\(bg) → \(args[2])")
