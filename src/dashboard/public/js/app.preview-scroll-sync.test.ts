import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

type MatchMediaResult = {
  matches: boolean
  media: string
  onchange: null
  addEventListener: () => void
  removeEventListener: () => void
  addListener: () => void
  removeListener: () => void
  dispatchEvent: () => boolean
}

class FakeElement {
  style: Record<string, string>
  offsetHeight: number
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  private readonly rectTop: number

  constructor(offsetHeight: number, rectTop: number, options?: {
    scrollTop?: number
    scrollHeight?: number
    clientHeight?: number
  }) {
    this.style = {}
    this.offsetHeight = offsetHeight
    this.rectTop = rectTop
    this.scrollTop = options?.scrollTop ?? 0
    this.scrollHeight = options?.scrollHeight ?? offsetHeight
    this.clientHeight = options?.clientHeight ?? offsetHeight
  }

  getBoundingClientRect() {
    return {
      top: this.rectTop,
      bottom: this.rectTop + this.offsetHeight,
      left: 0,
      right: 0,
      width: 0,
      height: this.offsetHeight,
      x: 0,
      y: this.rectTop,
      toJSON: () => ({}),
    }
  }

  addEventListener() {
    // no-op for tests
  }
}

function createDashboardAppHarness(options: {
  isDesktop: boolean
  currentSection: string
  pageScrollY: number
  previewCardHeight?: number
  formCardOffsetHeight?: number
  formCardScrollHeight?: number
  formCardClientHeight?: number
  formRectTop?: number
  windowInnerHeight?: number
}) {
  const previewCardHeight = options.previewCardHeight ?? 300
  const formCardOffsetHeight = options.formCardOffsetHeight ?? 1200
  const formCardScrollHeight = options.formCardScrollHeight ?? 1200
  const formCardClientHeight = options.formCardClientHeight ?? 600
  const formRectTop = options.formRectTop ?? -300
  const windowInnerHeight = options.windowInnerHeight ?? 600

  const previewCard = new FakeElement(previewCardHeight, 0)
  const formCard = new FakeElement(formCardOffsetHeight, formRectTop, {
    scrollHeight: formCardScrollHeight,
    clientHeight: formCardClientHeight,
  })

  const elementMap = new Map<string, unknown>([
    ['creator-preview-card', previewCard],
    ['creator-form-card', formCard],
  ])

  const documentMock = {
    addEventListener: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    getElementById: (id: string) => elementMap.get(id) ?? null,
    querySelector: vi.fn(() => null),
  }

  const matchMediaMock = vi.fn((_query: string): MatchMediaResult => ({
    matches: options.isDesktop,
    media: '(min-width: 1001px)',
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }))

  const rafMock = vi.fn((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })

  return {
    previewCard,
    documentMock,
    matchMediaMock,
    rafMock,
    currentSection: options.currentSection,
    pageScrollY: options.pageScrollY,
    windowInnerHeight,
  }
}

describe('dashboard embed creator preview scroll sync', () => {
  it('synchronizes preview transform with form scroll progress on desktop', () => {
    const appSource = readFileSync(join(process.cwd(), 'src/dashboard/public/js/app.js'), 'utf8')
    const harness = createDashboardAppHarness({
      isDesktop: true,
      currentSection: 'embed-creator',
      pageScrollY: 300,
    })

    const originalDocument = globalThis.document
    const originalWindow = (globalThis as Record<string, unknown>).window
    const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement

    try {
      ;(globalThis as Record<string, unknown>).document = harness.documentMock
      ;(globalThis as Record<string, unknown>).HTMLElement = FakeElement
      ;(globalThis as Record<string, unknown>).window = {
        ...globalThis,
        matchMedia: harness.matchMediaMock,
        requestAnimationFrame: harness.rafMock,
        scrollY: harness.pageScrollY,
        innerHeight: harness.windowInnerHeight,
      }

      const exposeApi = `${appSource}\n;globalThis.__dashboardTestApi = { scheduleCreatorPreviewScrollSync, setCurrentSection: (value) => { currentSection = value } };`
      // eslint-disable-next-line no-new-func
      new Function(exposeApi)()

      const api = (globalThis as Record<string, unknown>).__dashboardTestApi as {
        scheduleCreatorPreviewScrollSync: () => void
        setCurrentSection: (section: string) => void
      }

      api.setCurrentSection(harness.currentSection)
      api.scheduleCreatorPreviewScrollSync()

      expect(harness.previewCard.style.transform).toBe('translateY(450px)')
    } finally {
      delete (globalThis as Record<string, unknown>).__dashboardTestApi

      if (typeof originalDocument === 'undefined') {
        delete (globalThis as Record<string, unknown>).document
      } else {
        ;(globalThis as Record<string, unknown>).document = originalDocument
      }

      if (typeof originalWindow === 'undefined') {
        delete (globalThis as Record<string, unknown>).window
      } else {
        ;(globalThis as Record<string, unknown>).window = originalWindow
      }

      if (typeof originalHTMLElement === 'undefined') {
        delete (globalThis as Record<string, unknown>).HTMLElement
      } else {
        ;(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement
      }
    }
  })

  it('resets preview transform and skips scheduling outside desktop embed view', () => {
    const appSource = readFileSync(join(process.cwd(), 'src/dashboard/public/js/app.js'), 'utf8')
    const harness = createDashboardAppHarness({
      isDesktop: false,
      currentSection: 'embed-creator',
      pageScrollY: 300,
    })
    harness.previewCard.style.transform = 'translateY(250px)'

    const originalDocument = globalThis.document
    const originalWindow = (globalThis as Record<string, unknown>).window
    const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement

    try {
      ;(globalThis as Record<string, unknown>).document = harness.documentMock
      ;(globalThis as Record<string, unknown>).HTMLElement = FakeElement
      ;(globalThis as Record<string, unknown>).window = {
        ...globalThis,
        matchMedia: harness.matchMediaMock,
        requestAnimationFrame: harness.rafMock,
        scrollY: harness.pageScrollY,
        innerHeight: harness.windowInnerHeight,
      }

      const exposeApi = `${appSource}\n;globalThis.__dashboardTestApi = { scheduleCreatorPreviewScrollSync, setCurrentSection: (value) => { currentSection = value } };`
      // eslint-disable-next-line no-new-func
      new Function(exposeApi)()

      const api = (globalThis as Record<string, unknown>).__dashboardTestApi as {
        scheduleCreatorPreviewScrollSync: () => void
        setCurrentSection: (section: string) => void
      }

      api.setCurrentSection(harness.currentSection)
      api.scheduleCreatorPreviewScrollSync()

      expect(harness.previewCard.style.transform).toBe('')
      expect(harness.rafMock).not.toHaveBeenCalled()
    } finally {
      delete (globalThis as Record<string, unknown>).__dashboardTestApi

      if (typeof originalDocument === 'undefined') {
        delete (globalThis as Record<string, unknown>).document
      } else {
        ;(globalThis as Record<string, unknown>).document = originalDocument
      }

      if (typeof originalWindow === 'undefined') {
        delete (globalThis as Record<string, unknown>).window
      } else {
        ;(globalThis as Record<string, unknown>).window = originalWindow
      }

      if (typeof originalHTMLElement === 'undefined') {
        delete (globalThis as Record<string, unknown>).HTMLElement
      } else {
        ;(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement
      }
    }
  })

  it('resets preview transform when form has no effective scroll range', () => {
    const appSource = readFileSync(join(process.cwd(), 'src/dashboard/public/js/app.js'), 'utf8')
    const harness = createDashboardAppHarness({
      isDesktop: true,
      currentSection: 'embed-creator',
      pageScrollY: 300,
      formCardOffsetHeight: 500,
      formCardScrollHeight: 500,
      formCardClientHeight: 700,
      windowInnerHeight: 700,
    })
    harness.previewCard.style.transform = 'translateY(320px)'

    const originalDocument = globalThis.document
    const originalWindow = (globalThis as Record<string, unknown>).window
    const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement

    try {
      ;(globalThis as Record<string, unknown>).document = harness.documentMock
      ;(globalThis as Record<string, unknown>).HTMLElement = FakeElement
      ;(globalThis as Record<string, unknown>).window = {
        ...globalThis,
        matchMedia: harness.matchMediaMock,
        requestAnimationFrame: harness.rafMock,
        scrollY: harness.pageScrollY,
        innerHeight: harness.windowInnerHeight,
      }

      const exposeApi = `${appSource}\n;globalThis.__dashboardTestApi = { scheduleCreatorPreviewScrollSync, setCurrentSection: (value) => { currentSection = value } };`
      // eslint-disable-next-line no-new-func
      new Function(exposeApi)()

      const api = (globalThis as Record<string, unknown>).__dashboardTestApi as {
        scheduleCreatorPreviewScrollSync: () => void
        setCurrentSection: (section: string) => void
      }

      api.setCurrentSection(harness.currentSection)
      api.scheduleCreatorPreviewScrollSync()

      expect(harness.previewCard.style.transform).toBe('')
    } finally {
      delete (globalThis as Record<string, unknown>).__dashboardTestApi

      if (typeof originalDocument === 'undefined') {
        delete (globalThis as Record<string, unknown>).document
      } else {
        ;(globalThis as Record<string, unknown>).document = originalDocument
      }

      if (typeof originalWindow === 'undefined') {
        delete (globalThis as Record<string, unknown>).window
      } else {
        ;(globalThis as Record<string, unknown>).window = originalWindow
      }

      if (typeof originalHTMLElement === 'undefined') {
        delete (globalThis as Record<string, unknown>).HTMLElement
      } else {
        ;(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement
      }
    }
  })
})
