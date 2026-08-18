import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import MapBuilder from './builder/MapBuilder.jsx'
import GpsDemo from './pages/GpsDemo.jsx'
import Driver from './pages/Driver.jsx'

const path = window.location.pathname.replace(/\/$/, '')
const Page =
  path === '/builder' ? MapBuilder :
  path === '/gps'     ? GpsDemo :
  path === '/driver'  ? Driver :
  App

createRoot(document.getElementById('root')).render(
  <StrictMode><Page /></StrictMode>,
)
