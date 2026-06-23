"use client"

import { cn } from "@/lib/utils"
import React, { useEffect, useState } from "react"

// Shiki is large and pulls every grammar/theme into whatever chunk imports it,
// so we load it lazily (only once a code block actually renders) and cache
// highlighted HTML by code+language+theme. Streaming replays the same growing
// code string many times per second; the cache + debounce below collapse that
// into a single highlight pass once the text settles.
const HIGHLIGHT_CACHE = new Map<string, string>()
const HIGHLIGHT_CACHE_MAX = 200

function rememberHighlight(key: string, html: string) {
  // Cheap FIFO eviction so a long streaming session can't grow the cache without bound.
  if (HIGHLIGHT_CACHE.size >= HIGHLIGHT_CACHE_MAX) {
    const oldest = HIGHLIGHT_CACHE.keys().next().value
    if (oldest !== undefined) HIGHLIGHT_CACHE.delete(oldest)
  }
  HIGHLIGHT_CACHE.set(key, html)
}

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip border",
        "border-border bg-card text-card-foreground rounded-xl",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: string
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlockCode({
  code,
  language = "tsx",
  theme = "github-light",
  className,
  ...props
}: CodeBlockCodeProps) {
  const cacheKey = `${theme}::${language}::${code}`
  // Holds the most recently highlighted HTML, used as the render source once
  // its result lands in the cache. State only ever changes from the async path
  // below — empty/cached cases are resolved synchronously during render.
  const [, setResolvedTick] = useState(0)

  useEffect(() => {
    // Nothing to highlight, or this exact code is already cached.
    if (!code || HIGHLIGHT_CACHE.has(cacheKey)) return

    // Debounce: while the code is still streaming in, the timer keeps getting
    // cleared, so Shiki only runs once the string stops changing. The previous
    // highlighted HTML stays on screen until then (no flash back to plain).
    let cancelled = false
    const timer = setTimeout(async () => {
      const { codeToHtml } = await import("shiki")
      const html = await codeToHtml(code, { lang: language, theme })
      if (cancelled) return
      rememberHighlight(cacheKey, html)
      setResolvedTick((n) => n + 1)
    }, 120)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code, language, theme, cacheKey])

  const classNames = cn(
    "w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4",
    className
  )

  const highlightedHtml = !code
    ? "<pre><code></code></pre>"
    : (HIGHLIGHT_CACHE.get(cacheKey) ?? null)

  // SSR fallback: render plain code until Shiki has highlighted this snippet.
  return highlightedHtml ? (
    <div
      className={classNames}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      {...props}
    />
  ) : (
    <div className={classNames} {...props}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock }
