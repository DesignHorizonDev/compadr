import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@compadr/tokens/tokens.css'
import './shell.css'
import { App } from './App.tsx'
import { addFavicon } from './favicon.ts'
import { httpReportSource } from './reports.ts'
import { httpReviewSource } from './reviews.ts'
import { httpDraftSource } from './drafts.ts'
import { httpPortalSource } from './portal.ts'
import { httpDraftDecisionSource, httpPlainSource } from './assist.ts'

addFavicon(document)

const root = document.getElementById('root')
if (!root) throw new Error('The page has no #root element')

createRoot(root).render(
  <StrictMode>
    <App
      source={httpReportSource()}
      reviews={httpReviewSource()}
      drafts={httpDraftSource()}
      portal={httpPortalSource()}
      plain={httpPlainSource()}
      drafting={httpDraftDecisionSource()}
    />
  </StrictMode>
)
