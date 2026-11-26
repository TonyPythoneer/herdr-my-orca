// Locate and verify visible text in the real native screenshot, never in a synthetic render.
// Apple Vision is part of macOS; no network, external API, or dependency download.
import Foundation
import Vision
import ImageIO
import CoreGraphics
guard [2, 6].contains(CommandLine.arguments.count),
      let source = CGImageSourceCreateWithURL(URL(fileURLWithPath:CommandLine.arguments[1]) as CFURL,nil),
      let original = CGImageSourceCreateImageAtIndex(source,0,nil) else { exit(2) }
var crop = CGRect(x:0,y:0,width:original.width,height:original.height)
if CommandLine.arguments.count == 6 {
    let values = CommandLine.arguments[2...5].compactMap(Double.init)
    guard values.count == 4, values[0] >= 0, values[1] >= 0,
          values[2] <= 1, values[3] <= 1, values[0] < values[2], values[1] < values[3] else { exit(2) }
    crop = CGRect(x:values[0] * Double(original.width), y:values[1] * Double(original.height),
                  width:(values[2]-values[0]) * Double(original.width), height:(values[3]-values[1]) * Double(original.height)).integral
}
guard let image = original.cropping(to:crop) else { exit(2) }
// Upsample small, antialiased native labels before recognition; normalized boxes
// remain in the original viewport coordinate system.
let scale = 2
let context = CGContext(data:nil,width:image.width * scale,height:image.height * scale,
                        bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)
context?.interpolationQuality = .high
context?.draw(image,in:CGRect(x:0,y:0,width:CGFloat(image.width * scale),height:CGFloat(image.height * scale)))
let recognitionImage = context?.makeImage() ?? image
let request=VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
try VNImageRequestHandler(cgImage:recognitionImage,options:[:]).perform([request])
let rows: [[String:Any]] = (request.results ?? []).compactMap { observation in
    guard let candidate=observation.topCandidates(1).first else { return nil }
    let box=observation.boundingBox
    return ["text":candidate.string,"confidence":Double(candidate.confidence),
            "x":(Double(crop.minX) + Double(box.midX) * Double(crop.width)) / Double(original.width),
            "y":(Double(crop.minY) + Double(1-box.midY) * Double(crop.height)) / Double(original.height),
            "width":Double(box.width) * Double(crop.width) / Double(original.width),
            "height":Double(box.height) * Double(crop.height) / Double(original.height)]
}
let data=try JSONSerialization.data(withJSONObject:rows)
FileHandle.standardOutput.write(data)
