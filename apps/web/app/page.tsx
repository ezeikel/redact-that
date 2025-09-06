"use client"

import { useState, useRef, useEffect, type DragEvent } from "react"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import {
  faCloudUploadAlt,
  faSpinner,
  faDownload,
  faFileImage,
  faBrain
} from "@fortawesome/pro-solid-svg-icons"
import { processImageWithVisionApi } from "./actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"

type PiiData = {
  id: number
  label: string
  text: string
  bbox: [number, number, number, number] // [x, y, width, height]
  vertices?: Array<{ x: number, y: number }> // raw vertices from Vision API
  redacted: boolean
  confidence?: number // matching confidence score (0-1)
  matchType?: string // type of match (exact, fuzzy, etc.)
}

type ProcessResult = {
  piiData?: PiiData[]
  error?: string
  width?: number
  height?: number
}

type LoadingStep = "idle" | "processing" | "done"

const PROCESSING_MESSAGES = [
  "Processing with AI...",
  "Scanning for sensitive information...",
  "Detecting personal data...",
  "Analyzing document structure...",
  "Extracting text with OCR...",
  "Identifying patterns and information...",
  "Running smart detection algorithms...",
  "Mapping text locations...",
  "Almost there...",
  "Finalizing results...",
]

const HomePage = () => {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [piiData, setPiiData] = useState<PiiData[]>([])
  const [loadingStep, setLoadingStep] = useState<LoadingStep>("idle")
  const [isDragging, setIsDragging] = useState(false)
  const [imageDimensions, setImageDimensions] = useState<{ width: number, height: number } | null>(null)
  const [processingMessage, setProcessingMessage] = useState(PROCESSING_MESSAGES[0])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isLoading = loadingStep === "processing"

  // cycle through processing messages
  useEffect(() => {
    if (loadingStep !== "processing") return

    const interval = setInterval(() => {
      setProcessingMessage(prev => {
        const currentIndex = PROCESSING_MESSAGES.indexOf(prev)
        const nextIndex = (currentIndex + 1) % PROCESSING_MESSAGES.length
        return PROCESSING_MESSAGES[nextIndex]
      })
    }, 1500) // Change message every 1.5 seconds

    return () => clearInterval(interval)
  }, [loadingStep])

  // draw the image and redactions on the canvas
  useEffect(() => {
    if (!imageSrc || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = "anonymous"
    img.src = imageSrc
    img.onload = () => {
      // set canvas to natural image size for accurate coordinate mapping
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // always draw the original image first
      ctx.drawImage(img, 0, 0)

      // only add redactions if processing is complete and we have image dimensions
      if (!isLoading && imageDimensions) {
        // if Vision API dimensions are swapped compared to canvas, apply coordinate transformation
        const needsRotation = (imageDimensions.width > imageDimensions.height) !== (canvas.width > canvas.height)

        // calculate scale factors
        const scaleX = canvas.width / (needsRotation ? imageDimensions.height : imageDimensions.width)
        const scaleY = canvas.height / (needsRotation ? imageDimensions.width : imageDimensions.height)

        // apply coordinate transformation based on whether Vision API processed image rotated
        ctx.fillStyle = "black"

        piiData.forEach((pii) => {
          if (pii.redacted && pii.vertices && pii.vertices.length > 0) {
            let transformedVertices

            if (needsRotation) {
              // apply 90° clockwise rotation then scale
              transformedVertices = pii.vertices.map(v => ({
                x: (imageDimensions.height - v.y) * scaleX,
                y: v.x * scaleY
              }))
            } else {
              // just scale directly
              transformedVertices = pii.vertices.map(v => ({
                x: v.x * scaleX,
                y: v.y * scaleY
              }))
            }

            // draw polygon using the transformed vertices
            ctx.beginPath()
            ctx.moveTo(transformedVertices[0].x, transformedVertices[0].y)
            for (let i = 1; i < transformedVertices.length; i++) {
              ctx.lineTo(transformedVertices[i].x, transformedVertices[i].y)
            }
            ctx.closePath()
            ctx.fill()
          }
        })
      }
    }
  }, [imageSrc, piiData, imageDimensions, isLoading])

  const processImage = (file: File) => {
    resetState()
    setLoadingStep("processing")
    setProcessingMessage(PROCESSING_MESSAGES[0]) // Reset to first message
    const imageUrl = URL.createObjectURL(file)
    setImageSrc(imageUrl)

    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = async () => {
      const base64String = (reader.result as string).split(",")[1]
      if (!base64String) {
        alert("Could not read image file.")
        resetState()
        return
      }

      const result = await processImageWithVisionApi(base64String) as ProcessResult

      if (result.error) {
        alert(`Error: ${result.error}`)
        resetState()
        return
      }

      // store image dimensions from the Vision API processing
      if (result.width && result.height) {
        setImageDimensions({ width: result.width, height: result.height })
      }

      if (result.piiData && result.piiData.length > 0) {
        setPiiData(result.piiData)
      } else {
        alert("No sensitive information was found in the document.")
      }
      setLoadingStep("done")
    }
    reader.onerror = () => {
      alert("Failed to read the image file.")
      resetState()
    }
  }

  const handleFileChange = (file: File | null) => {
    if (file && (file.type === "image/jpeg" || file.type === "image/png")) {
      processImage(file)
    } else {
      alert("Please upload a JPG or PNG image.")
    }
  }

  const resetState = () => {
    // revoke the previous object URL to free up memory
    if (imageSrc) {
      URL.revokeObjectURL(imageSrc)
    }
    setImageSrc(null)
    setPiiData([])
    setImageDimensions(null)
    setLoadingStep("idle")
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d")
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0])
    }
  }

  const handleDragEvents = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true)
    } else if (e.type === "dragleave") {
      setIsDragging(false)
    }
  }

  const toggleRedaction = (id: number) => {
    setPiiData((prev) => prev.map((pii) => (pii.id === id ? { ...pii, redacted: !pii.redacted } : pii)))
  }

  const downloadImage = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement("a")
    link.download = "redacted-image.png"
    link.href = canvas.toDataURL("image/png")
    link.click()
  }

  return (
    <div className="bg-slate-50 min-h-screen w-full text-slate-900">
      <div className="container mx-auto p-4 md:p-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight">RedactThat</h1>
          <p className="text-slate-600 mt-2">
            Upload an image to automatically detect and redact sensitive information.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <Card className="h-full">
              <CardContent className="p-6 h-full flex items-center justify-center relative">
                {!imageSrc && !isLoading && (
                  <div
                    className={`w-full h-[60vh] max-h-[700px] border-2 border-dashed rounded-lg flex flex-col items-center justify-center transition-colors ${isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-100"}`}
                    onDrop={handleDrop}
                    onDragOver={handleDragEvents}
                    onDragEnter={handleDragEvents}
                    onDragLeave={handleDragEvents}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FontAwesomeIcon icon={faCloudUploadAlt} className="w-16 h-16 text-slate-400 mb-4" />
                    <p className="text-slate-600 font-semibold">Drag & drop an image here</p>
                    <p className="text-slate-500 text-sm">or</p>
                    <Button variant="outline" className="mt-2 bg-transparent">
                      Browse Files
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png, image/jpeg"
                      className="hidden"
                      onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                    />
                    <p className="text-xs text-slate-400 mt-4">Supports PNG and JPG</p>
                  </div>
                )}
                {(isLoading || imageSrc) && (
                  <div className="w-full h-full relative flex items-center justify-center">
                    <canvas ref={canvasRef} className="max-w-full max-h-[70vh] object-contain rounded-md shadow-md" />
                    {isLoading && (
                      <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex flex-col items-center justify-center z-10 rounded-lg">
                        <FontAwesomeIcon icon={faSpinner} className="w-12 h-12 text-blue-600 animate-spin" />
                        <p className="mt-4 text-lg font-semibold text-slate-700 flex items-center gap-2 transition-all duration-300">
                          <FontAwesomeIcon icon={faBrain} className="w-5 h-5" />
                          {processingMessage}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <Card className="sticky top-8">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FontAwesomeIcon icon={faFileImage} className="w-5 h-5" />
                  Detected Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                {piiData.length > 0 ? (
                  <div className="space-y-4">
                    {piiData.map((pii) => (
                      <div key={pii.id} className="flex items-center space-x-3 p-3 bg-slate-100 rounded-md">
                        <Checkbox
                          id={`pii-${pii.id}`}
                          checked={pii.redacted}
                          onCheckedChange={() => toggleRedaction(pii.id)}
                        />
                        <Label htmlFor={`pii-${pii.id}`} className="flex-grow cursor-pointer">
                          <span className="font-semibold">{pii.label}:</span>
                          <span className="text-slate-600 ml-2 truncate">{pii.text}</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-10 text-slate-500">
                    {isLoading ? <p>Processing...</p> : <p>Upload an image to see detected PII.</p>}
                  </div>
                )}
              </CardContent>
              <CardFooter>
                <Button className="w-full" onClick={downloadImage} disabled={!imageSrc || isLoading}>
                  <FontAwesomeIcon icon={faDownload} className="mr-2 h-4 w-4" />
                  Download Redacted Image
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HomePage