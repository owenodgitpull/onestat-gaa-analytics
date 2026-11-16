/**
 * Report (print) mode: set by the PDF print page (pages/ReportPrint.tsx). Interactive views read it to show their
 * default, complete state with no controls (e.g. the Kickouts tab skips the one-kickout picker and shows the patterns).
 * Off everywhere else, so nothing changes on screen.
 */
import { createContext, useContext } from 'react'

export const ReportModeContext = createContext<{ print: boolean }>({ print: false })
export const useReportMode = () => useContext(ReportModeContext)
