import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { OAuth2Client } from "google-auth-library";

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_DIR = process.env.DATA_DIR || "/var/data";
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const SAVED_FILE = path.join(DATA_DIR, "saved-areas.json");
app.use(cors());
app.use(express.json({limit:"1mb"}));

async function readJson(file, fallback){try{return JSON.parse(await fs.readFile(file,"utf8"))}catch{return fallback}}
async function writeJson(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2))}

const googleClient = new OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID);
async function auth(req,res,next){
  const h=req.headers.authorization||"", token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token||!process.env.GOOGLE_WEB_CLIENT_ID)return res.status(401).json({error:"Google sign-in required"});
  try{const ticket=await googleClient.verifyIdToken({idToken:token,audience:process.env.GOOGLE_WEB_CLIENT_ID});req.user=ticket.getPayload();next()}
  catch{res.status(401).json({error:"Invalid Google ID token"})}
}

app.get("/health",(req,res)=>res.json({ok:true,service:"trucker-find-api",time:new Date().toISOString()}));

app.get("/api/places",async(req,res)=>{
  const {lat,lng,q="truck stop"}=req.query;
  if(!lat||!lng)return res.status(400).json({error:"lat and lng are required"});
  if(!process.env.GOOGLE_PLACES_API_KEY)return res.status(503).json({error:"Google Places is not configured"});
  const body={textQuery:q,locationBias:{circle:{center:{latitude:Number(lat),longitude:Number(lng)},radius:25000}},maxResultCount:10};
  const r=await fetch("https://places.googleapis.com/v1/places:searchText",{method:"POST",headers:{"Content-Type":"application/json","X-Goog-Api-Key":process.env.GOOGLE_PLACES_API_KEY,"X-Goog-FieldMask":"places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.priceLevel,places.currentOpeningHours,places.googleMapsUri"},body:JSON.stringify(body)});
  const data=await r.json(); if(!r.ok)return res.status(r.status).json(data); res.json(data);
});

app.get("/api/reports",async(req,res)=>{
  const reports=await readJson(REPORTS_FILE,[]), cutoff=Date.now()-86400000;
  res.json(reports.filter(r=>new Date(r.createdAt).getTime()>=cutoff));
});
app.post("/api/reports",auth,async(req,res)=>{
  const reports=await readJson(REPORTS_FILE,[]);
  const report={id:crypto.randomUUID(),userId:req.user.sub,userName:req.user.name||"Driver",createdAt:new Date().toISOString(),...req.body};
  reports.unshift(report); await writeJson(REPORTS_FILE,reports.slice(0,5000)); res.status(201).json(report);
});
app.get("/api/saved-areas",auth,async(req,res)=>{
  const all=await readJson(SAVED_FILE,{}); res.json(all[req.user.sub]||[]);
});
app.post("/api/saved-areas",auth,async(req,res)=>{
  const all=await readJson(SAVED_FILE,{}), list=all[req.user.sub]||[];
  const area={...req.body,id:req.body.id||crypto.randomUUID(),savedAt:new Date().toISOString()};
  all[req.user.sub]=[area,...list.filter(x=>x.id!==area.id)].slice(0,100);
  await writeJson(SAVED_FILE,all); res.status(201).json(area);
});
app.delete("/api/saved-areas/:id",auth,async(req,res)=>{
  const all=await readJson(SAVED_FILE,{});
  all[req.user.sub]=(all[req.user.sub]||[]).filter(x=>x.id!==req.params.id);
  await writeJson(SAVED_FILE,all); res.json({ok:true});
});
app.listen(PORT,"0.0.0.0",()=>console.log("Trucker Find API listening on "+PORT));
