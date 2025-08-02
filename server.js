const express = require('express')
const { MongoClient, ObjectId } = require('mongodb')
const multiparty = require('multiparty')
const fs = require('fs/promises')
const pdf = require('pdf-extraction')
const axios = require('axios')
const cors = require("cors");
require('dotenv').config()

const app = express()
const PORT = process.env.PORT || 3001

const MONGODB_URI = process.env.MONGODB_URI
const client = new MongoClient(MONGODB_URI)
const dbName = 'Summary'

const API_KEY = process.env.API_KEY
const GEMINI_URL = process.env.GEMINI_URL

// Middleware for parsing JSON
app.use(cors());

// GET: /api/questions?id=xxx
app.get('/api/question', async (req, res) => {
  const id = req.query.id

  if (typeof id !== 'string' || !ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid or missing id' })
  }

  try {
    await client.connect()
    const db = client.db(dbName)
    const item = await db.collection('questions').findOne({ _id: new ObjectId(id) })

    if (!item) {
      return res.status(404).json({ error: 'Item not found' })
    }

    return res.status(200).json(item)
  } catch (error) {
    console.error('GET /api/questions error:', error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// POST: /api/questions (multipart/form-data with PDF)
app.post('/api/question', (req, res) => {
  const form = new multiparty.Form()

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: 'File upload failed' })

    const file = files.file?.[0]
    if (!file || !file.path.endsWith('.pdf')) {
      return res.status(400).json({ error: 'Missing or invalid PDF file' })
    }

    try {
      const buffer = await fs.readFile(file.path)
      const data = await pdf(buffer)
      let fullText = data.text || ''

      const maxChars = 15000
      if (fullText.length > maxChars) {
        fullText = fullText.substring(0, maxChars)
      }

      const prompt = `
ฉันจะโยนสไลน์ให้แล้วอยากให้ช่วยสรุปข้อมูลออกมาเป็นคำถามตอบเกี่ยวกับวิชา ชีวะ
เป็นข้อมูล json มีเลขข้อ คำถาม choice 5 ข้อ และเฉลย เป็นเลขลำดับใน choice list เท่านั้น 0-4
ต้องทำทั้งหมด 15 ข้อ ออกมาเป็น list ของตัวแปรชื่อ data : []
อยากให้ มี ข้อที่ต้องวิเคราะห์ 2 ข้อ
มีตัวแปรชื่อ title เอาไว้เก็บหัวข้อเรื่องความยาวไม่เกิน 50 ตัวอักษร
ตัวอย่าง 1 ชุด รูปแบบ json เท่านั้น
title : "ชีวะ"
data : [ 
  {
    number: 1,
    question: "เซลล์ใดเป็นเซลล์ของสิ่งมีชีวิต?",
    choices: ["เซลล์แสง", "เซลล์กล้ามเนื้อ", "เซลล์หิน", "เซลล์ลม", "เซลล์เสียง"],
    answer: 1 
  },
  ...
];

ข้อมูลสไลด์:
${fullText}
      `

      const response = await axios.post(`${process.env.GEMINI_URL}?key=${process.env.API_KEY}`, {
        contents: [{ parts: [{ text: prompt }] }],
        })

      const json = await response.data
      const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      const start = rawText.indexOf('{')
      const end = rawText.lastIndexOf('}')

      if (start === -1 || end === -1) {
        return res.status(500).json({ error: 'Failed to parse response', raw: rawText })
      }

      const parsed = JSON.parse(rawText.substring(start, end + 1))

      await client.connect()
      const db = client.db(dbName)
      const collection = db.collection('questions')
      const result = await collection.insertOne({ title:parsed.title, data: parsed.data })

      return res.status(200).json({ insertedId: result.insertedId })
    } catch (e) {
      console.error('POST /api/questions error:', e)
      return res.status(500).json({ error: 'Internal Server Error' })
    }
  })
})

app.get('/api/questions', async (req, res) => {

  try {
    await client.connect()
    const db = client.db(dbName)
    const item = await db.collection('questions').find({}).toArray()

    if (!item) {
      return res.status(404).json({ error: 'Item not found' })
    }
    
    const result = item.map((item)=>{
      return {
        title : item.title,
        id : item._id
      }
    })

    return res.status(200).json(result)
  } catch (error) {
    console.error('GET /api/questions error:', error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`)
})
