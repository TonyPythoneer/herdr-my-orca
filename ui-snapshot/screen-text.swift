// Locate and verify visible text in the real native screenshot, never in a synthetic render.
// Apple Vision is part of macOS; no network, external API, or dependency download.
import Foundation
import Vision
import ImageIO
import CoreGraphics
guard CommandLine.arguments.count == 2,
      let source = CGImageSourceCreateWithURL(URL(fileURLWithPath:CommandLine.arguments[1]) as CFURL,nil),
      let image = CGImageSourceCreateImageAtIndex(source,0,nil) else { exit(2) }
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
            "x":Double(box.midX),"y":Double(1-box.midY),
            "width":Double(box.width),"height":Double(box.height)]
}
let data=try JSONSerialization.data(withJSONObject:rows)
FileHandle.standardOutput.write(data)
