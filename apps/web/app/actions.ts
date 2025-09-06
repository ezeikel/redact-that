"use server"

import { openai } from "@ai-sdk/openai"
import { generateObject } from "ai"
import { z } from "zod"
import vision from "@google-cloud/vision"
import sizeOf from 'image-size'
import { distance } from 'fastest-levenshtein'

// Type definitions for Google Vision API
type Vertex = {
  x?: number | null
  y?: number | null
}

type BoundingBox = {
  vertices?: Vertex[] | null
}

type WordInfo = {
  text: string
  boundingBox?: BoundingBox | null
}

// define the schema for the PII data we expect from the AI model
const PiiSchema = z.object({
  pii: z
    .array(
      z.object({
        text: z.string().describe("The exact text of the personally identifiable information."),
        label: z.string().describe("A category for the PII, e.g., 'Name', 'Address', 'Phone Number', 'License Plate'."),
      }),
    )
    .describe("An array of PII objects found in the text."),
})

// helper function to create the Vision API client using base64 credentials
const createVisionClient = () => {
  const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64
  if (!credentialsBase64) {
    throw new Error("Server configuration error: GOOGLE_APPLICATION_CREDENTIALS_BASE64 is not set.")
  }
  try {
    const serviceAccountJson = JSON.parse(Buffer.from(credentialsBase64, "base64").toString("utf8"))
    return new vision.ImageAnnotatorClient({
      credentials: serviceAccountJson,
    })
  } catch (error) {
    console.error("Failed to parse Google Cloud credentials:", error)
    throw new Error("Server configuration error: Invalid Google Cloud credentials format.")
  }
}

// helper function to call OpenAI and identify PII in a block of text
const identifyPiiInText = async (text: string): Promise<{ text: string; label: string }[]> => {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OpenAI API key is not set.")
    throw new Error("Server configuration error: Missing OpenAI API key.")
  }
  try {
    const { object } = await generateObject({
      model: openai("gpt-4o"),
      schema: PiiSchema,
      prompt: `From the following text extracted from a UK document, identify ONLY true personally identifiable information (PII) that could identify a specific individual or vehicle. Focus on:

1. Vehicle registration numbers (UK format: typically 2-3 letters followed by 2-3 numbers and 3 letters, e.g., LV72EPC, AB12CDE)
2. PCN (Penalty Charge Notice) numbers (typically alphanumeric codes like ZY10241472)
3. Reference numbers, case numbers, or ticket numbers that are unique identifiers
4. Full names or partial names of individuals
5. Complete addresses (street names + house numbers + postcodes)
6. Phone numbers (UK format: +44 or 07xxx or 02xxx)
7. Email addresses
8. Dates of birth (not generic dates like service dates)
9. Any other unique identifying codes or numbers

DO NOT include:
- Generic times (like 11:06)
- Financial amounts (like £110, £55)
- Generic dates (like service dates, contravention dates)
- Location names without specific addresses (like "Downderry Road" without house number)
- Generic location descriptions (like "Outside No: 83" without context)

Only include information that could be used to identify a specific person or vehicle. Return the result as a JSON object. Text: "${text}"`,
    })

    console.log({object: JSON.stringify(object, null, 2)});

    return object.pii || []
  } catch (error) {
    console.error("Error identifying PII with OpenAI:", error)
    return []
  }
}

// main server action that orchestrates Google Vision and OpenAI
export const processImageWithVisionApi = async (imageBase64: string) => {
  try {
    // 1. initialize the Google Vision client
    const client = createVisionClient()

    // 1a. get original image dimensions
    const buffer = Buffer.from(imageBase64, 'base64')
    const { width, height } = sizeOf(buffer)

    // 2. call Google Vision API for OCR using DOCUMENT_TEXT_DETECTION
    const request = {
      image: { content: imageBase64 },
      features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
    }
    const [result] = await client.annotateImage(request)
    const annotation = result.fullTextAnnotation

    if (!annotation || !annotation.text) {
      return { error: "No text could be detected in the image." }
    }

    const fullText = annotation.text

    console.log({fullText: fullText.trim()});
    

    // extract words and their bounding boxes from the document structure
    const words: WordInfo[] = []
    if (annotation.pages) {
      for (const page of annotation.pages) {
        for (const block of page.blocks ?? []) {
          for (const paragraph of block.paragraphs ?? []) {
            for (const word of paragraph.words ?? []) {
              const wordText = word.symbols?.map((s) => s.text).join("") ?? ""
              words.push({
                text: wordText,
                boundingBox: word.boundingBox,
              })
            }
          }
        }
      }
    }

    // 3. call OpenAI API to find PII in the extracted text
    const identifiedPii = await identifyPiiInText(fullText)

    // 4. map the PII text back to the bounding boxes from Google Vision
    const piiWithBbox = mapPiiToBbox(identifiedPii, words)


    if (identifiedPii.length === 0) {
      return { piiData: [], width, height }
    }

    return { piiData: piiWithBbox, width, height }
  } catch (error) {
    console.error("Error in processImageWithVisionApi:", error)
    if (error instanceof Error) {
      return { error: error.message }
    }
    return { error: "An unexpected error occurred on the server." }
  }
}

// generic function to create search variants for any PII text
const createSearchVariants = (piiText: string): string[][] => {
  const variants: string[][] = []
  
  // normalize the original text
  const normalizedWords = piiText
    .trim()
    .split(/\s+/)
    .map(word => word.replace(/[^a-zA-Z0-9]/g, ""))
  
  // variant 1: Original normalized words
  variants.push(normalizedWords)
  
  // variant 2: All as one word (remove spaces)
  if (normalizedWords.length > 1) {
    variants.push([normalizedWords.join("")])
  }
  
  // variant 3: Add spaces between letters and numbers (for single words like AF12HPV)
  if (normalizedWords.length === 1) {
    const singleWord = normalizedWords[0]
    // split on letter-to-number and number-to-letter boundaries
    const spacedVariant = singleWord
      .replace(/([A-Za-z])(\d)/g, "$1 $2")  // letter followed by number
      .replace(/(\d)([A-Za-z])/g, "$1 $2")  // number followed by letter
      .split(/\s+/)
      .map(word => word.replace(/[^a-zA-Z0-9]/g, ""))
    
    if (spacedVariant.length > 1) {
      variants.push(spacedVariant)
    }
  }
  
  // variant 4: Handle hyphens properly (especially for addresses like CLACTON-ON-SEA)
  const expandHyphens = piiText
    .replace(/-/g, " ")  // replace hyphens with spaces
    .replace(/[,_.]/g, " ")  // replace other punctuation with spaces
    .trim()
    .split(/\s+/)
    .map(word => word.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(word => word.length > 0)  // remove empty strings
  
  if (expandHyphens.length !== normalizedWords.length || 
      JSON.stringify(expandHyphens) !== JSON.stringify(normalizedWords)) {
    variants.push(expandHyphens)
  }
  
  // variant 5: Generic character boundary splitting for any alphanumeric patterns
  if (normalizedWords.length === 1 && normalizedWords[0].length >= 4) {
    const word = normalizedWords[0]
    const possibleSplits = []
    
    // try splitting at different letter/number boundaries
    for (let i = 1; i < word.length; i++) {
      const char1 = word[i-1]
      const char2 = word[i]
      
      // split at letter->number or number->letter boundaries
      if ((char1.match(/[A-Z]/i) && char2.match(/\d/)) || 
          (char1.match(/\d/) && char2.match(/[A-Z]/i))) {
        possibleSplits.push([word.slice(0, i), word.slice(i)])
      }
      
      // for longer strings, try 3-way splits at reasonable positions
      if (word.length >= 6 && i >= 2 && i <= word.length - 2) {
        for (let j = i + 2; j < word.length; j++) {
          const char3 = word[j-1]
          const char4 = word[j]
          
          if ((char3.match(/[A-Z]/i) && char4.match(/\d/)) || 
              (char3.match(/\d/) && char4.match(/[A-Z]/i))) {
            possibleSplits.push([word.slice(0, i), word.slice(i, j), word.slice(j)])
            break // only try one 3-way split per starting position
          }
        }
      }
    }
    
    // add unique splits to variants
    possibleSplits.forEach(split => {
      if (split.length > 1 && split.every(part => part.length > 0)) {
        variants.push(split)
      }
    })
  }
  
  // remove duplicates
  const uniqueVariants = variants.filter((variant, index) => 
    variants.findIndex(v => JSON.stringify(v) === JSON.stringify(variant)) === index
  )
  
  return uniqueVariants
}

// helper function to create a PII match object
const createPiiMatch = (
  wordSlice: WordInfo[],
  id: number,
  pii: { text: string; label: string },
  confidence: number,
  matchType: string
) => {
  // combine all bounding box vertices
  const allVertices = wordSlice.flatMap((w) => w.boundingBox?.vertices ?? [])
  const validVertices = allVertices.filter((v) => typeof v.x === 'number' && typeof v.y === 'number')
  
  if (validVertices.length === 0) return null
  
  // calculate proper bounding box that handles rotated text
  const xCoords = validVertices.map((v) => v.x!).filter(x => x !== null && x !== undefined)
  const yCoords = validVertices.map((v) => v.y!).filter(y => y !== null && y !== undefined)
  
  const x0 = Math.min(...xCoords)
  const y0 = Math.min(...yCoords)
  const x1 = Math.max(...xCoords)
  const y1 = Math.max(...yCoords)
  
  const width = x1 - x0
  const height = y1 - y0
  const bbox: [number, number, number, number] = [x0, y0, width, height]

  return {
    id,
    label: pii.label,
    text: pii.text,
    bbox,
    vertices: validVertices,
    redacted: true,
    confidence,
    matchType
  }
}

// flexible matching for multi-word PII that might be spread across lines
const findFlexibleMatches = (searchVariants: string[][], wordMap: WordInfo[], foundPositions: Set<number>) => {
  const matches: Array<{
    words: WordInfo[],
    confidence: number,
    matchedWords: string[],
    positions: number[]
  }> = []
  
  for (const variant of searchVariants) {
    if (variant.length < 3) continue // only for multi-word patterns
    
    // find all occurrences of each word in the variant
    const wordPositions: number[][] = variant.map(targetWord => 
      wordMap
        .map((word, index) => ({ word: word.text, index }))
        .filter(item => item.word === targetWord)
        .map(item => item.index)
    )
    
    // check if we found all words
    if (wordPositions.some(positions => positions.length === 0)) {
      console.log(`Missing some words from variant: ${JSON.stringify(variant)}`)
      continue
    }
    
    // try to find combinations where words appear in reasonable proximity
    const findCombinations = (wordIndex: number, currentCombination: number[], usedPositions: Set<number>): void => {
      if (wordIndex >= variant.length) {
        // we've matched all words, check if it's a valid combination
        if (currentCombination.length === variant.length) {
          // calculate span (distance from first to last word)
          const minPos = Math.min(...currentCombination)
          const maxPos = Math.max(...currentCombination)
          const span = maxPos - minPos + 1
          
          // only accept if words are within reasonable distance (e.g., within 20 words)
          if (span <= 20 && !currentCombination.some(pos => foundPositions.has(pos))) {
            const matchedWords = currentCombination.map(pos => wordMap[pos])
            const confidence = Math.max(0.7, 1 - (span / 100)) // Lower confidence for widely spread words
            
            matches.push({
              words: matchedWords,
              confidence,
              matchedWords: variant,
              positions: currentCombination
            })
          }
        }
        return
      }
      
      // try each position for the current word
      for (const position of wordPositions[wordIndex]) {
        if (!usedPositions.has(position)) {
          const newUsedPositions = new Set(usedPositions)
          newUsedPositions.add(position)
          findCombinations(wordIndex + 1, [...currentCombination, position], newUsedPositions)
        }
      }
    }
    
    findCombinations(0, [], new Set())
  }
  
  // return best matches (highest confidence, prefer more compact spans)
  return matches
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3) // limit to top 3 matches to avoid too many duplicates
}

// fuzzy matching function for OCR errors
const fuzzyMatchPII = (piiText: string, words: WordInfo[], threshold = 0.8): Array<{position: number, confidence: number, matchedWords: number}> => {
  const matches: Array<{position: number, confidence: number, matchedWords: number}> = []
  const normalizedPii = piiText.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  
  // try matching with different word spans (1-5 words)
  for (let span = 1; span <= Math.min(5, words.length); span++) {
    for (let i = 0; i <= words.length - span; i++) {
      const candidate = words
        .slice(i, i + span)
        .map(w => w.text.replace(/[^a-zA-Z0-9]/g, "").toLowerCase())
        .join("")
      
      if (candidate.length > 0) {
        const similarity = 1 - (distance(normalizedPii, candidate) / Math.max(normalizedPii.length, candidate.length))
        
        if (similarity >= threshold) {
          matches.push({
            position: i,
            confidence: similarity,
            matchedWords: span
          })
        }
      }
    }
  }
  
  // sort by confidence descending and remove overlapping matches
  return matches
    .sort((a, b) => b.confidence - a.confidence)
    .filter((match, index, arr) => {
      // remove overlapping matches (keep the one with higher confidence)
      return !arr.slice(0, index).some(prev => 
        Math.abs(prev.position - match.position) < Math.max(prev.matchedWords, match.matchedWords)
      )
    })
}

// helper function to map PII phrases to their bounding boxes
const mapPiiToBbox = (
  piiList: { text: string; label: string }[],
  words: WordInfo[],
) => {
  const piiData: {
    id: number
    label: string
    text: string
    bbox: [number, number, number, number]
    vertices?: Vertex[]
    redacted: boolean
    confidence?: number
    matchType?: string
  }[] = []
  let piiIdCounter = 0

  // normalize word texts for matching
  const wordMap = words.map((w) => ({
    text: w.text.replace(/[^a-zA-Z0-9]/g, ""),
    boundingBox: w.boundingBox,
  }))

  piiList.forEach((pii) => {
    console.log(`Searching for ALL instances of PII: "${pii.text}"`)
    let instanceCount = 0

    // Create search variants for the PII text
    const searchVariants = createSearchVariants(pii.text)
    console.log(`Search variants for "${pii.text}":`, searchVariants)
    
    // DEBUG: Show address-specific information
    if (pii.text.includes("SHEPPARD")) {
      console.log(`\n=== ADDRESS DEBUG ===`)
      console.log(`Looking for: "${pii.text}"`)
      console.log(`Search variants:`, searchVariants)
      
      const relevantWords = wordMap
        .map((w, idx) => ({ word: w.text, index: idx }))
        .filter(w => 
          w.word.includes("5") || 
          w.word.includes("SHEPPARD") || 
          w.word.includes("CLOSE") || 
          w.word.includes("CLACTON") || 
          w.word.includes("8YA") ||
          w.word.includes("CO16") ||
          w.word.includes("ON") ||
          w.word.includes("SEA")
        )
      
      console.log(`Relevant OCR words:`, relevantWords)
      console.log(`=== END ADDRESS DEBUG ===\n`)
    }

    // step 1: Try exact matching with variants
    const foundPositions = new Set<number>()
    
    for (const variant of searchVariants) {
      for (let i = 0; i <= wordMap.length - variant.length; i++) {
        if (foundPositions.has(i)) continue // skip already found positions
        
        const wordSlice = wordMap.slice(i, i + variant.length)
        const sliceText = wordSlice.map((s) => s.text)

        if (JSON.stringify(sliceText) === JSON.stringify(variant)) {
          instanceCount++
          foundPositions.add(i)
          
          const match = createPiiMatch(wordSlice, piiIdCounter++, pii, 1.0, `exact variant: ${JSON.stringify(variant)}`)
          if (match) {
            piiData.push(match)
            console.log(`Found exact instance ${instanceCount} of "${pii.text}" (variant: ${JSON.stringify(variant)}) at position ${i}`)
          }
          
          // mark surrounding positions to avoid overlaps
          for (let j = 0; j < variant.length; j++) {
            foundPositions.add(i + j)
          }
        }
      }
    }
    
    // Step 2: Try flexible multi-word matching for addresses and multi-line PII
    if (searchVariants.some(variant => variant.length >= 4) && instanceCount === 0) {
      console.log(`Trying flexible multi-word matching for "${pii.text}"`)
      const flexibleMatches = findFlexibleMatches(searchVariants, wordMap, foundPositions)
      
      for (const flexMatch of flexibleMatches) {
        const match = createPiiMatch(flexMatch.words, piiIdCounter++, pii, flexMatch.confidence, `flexible match (${flexMatch.matchedWords.length} words)`)
        
        if (match) {
          piiData.push(match)
          instanceCount++
          console.log(`Found flexible instance ${instanceCount} of "${pii.text}" with ${flexMatch.matchedWords.length} matched words`)
          
          // mark all matched positions
          flexMatch.positions.forEach(pos => foundPositions.add(pos))
        }
      }
    }
    
    // step 3: Try fuzzy matching for OCR errors (only if we found few matches)
    if (instanceCount < 2) {
      console.log(`Only found ${instanceCount} exact matches, trying fuzzy matching for "${pii.text}"`)
      const fuzzyMatches = fuzzyMatchPII(pii.text, wordMap, 0.85)
      
      for (const fuzzyMatch of fuzzyMatches) {
        if (foundPositions.has(fuzzyMatch.position)) continue // Skip already found positions
        
        const wordSlice = wordMap.slice(fuzzyMatch.position, fuzzyMatch.position + fuzzyMatch.matchedWords)
        const match = createPiiMatch(wordSlice, piiIdCounter++, pii, fuzzyMatch.confidence, `fuzzy match (${(fuzzyMatch.confidence * 100).toFixed(1)}%)`)
        
        if (match) {
          piiData.push(match)
          instanceCount++
          console.log(`Found fuzzy instance ${instanceCount} of "${pii.text}" with confidence ${(fuzzyMatch.confidence * 100).toFixed(1)}% at position ${fuzzyMatch.position}`)
          
          // mark surrounding positions to avoid overlaps
          for (let j = 0; j < fuzzyMatch.matchedWords; j++) {
            foundPositions.add(fuzzyMatch.position + j)
          }
        }
      }
    }
    
    console.log(`Total instances found for "${pii.text}": ${instanceCount}`)
  })

  return piiData
} 