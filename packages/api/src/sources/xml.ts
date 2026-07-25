import { XMLParser } from "fast-xml-parser";

/**
 * Shared XML parsing for the RSS-based source adapters (YouTube, Odysee).
 *
 * The adapters previously hand-rolled XML extraction with regex, which silently
 * mis-parsed malformed remote payloads (e.g. YouTube occasionally serving a
 * `<yt:channelId>` with a truncated value) and created duplicate creator rows.
 * A real parser reads the document structurally and fails loudly instead of
 * returning garbage.
 */

export interface XmlParseFailure {
  readonly ok: false;
  readonly error: string;
}

export interface XmlParseSuccess {
  readonly ok: true;
  readonly document: XmlElement;
}

export type XmlParseResult = XmlParseSuccess | XmlParseFailure;

export type XmlValue = string | number | boolean | XmlElement | readonly XmlValue[];

export interface XmlElement {
  readonly [tagName: string]: XmlValue;
}

const parser = new XMLParser({
  // RSS/Atom feeds carry values on attributes (media:thumbnail url=,
  // itunes:image href=, enclosure url=/type=) and inside CDATA. Expose both.
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  // When an element has both attributes and text (e.g.
  // <guid isPermaLink="false">lbry://...</guid>), collect the text under a
  // stable "#text" key instead of letting attributes displace it.
  textNodeName: "#text",
  // Collapse repeated tags into arrays even when there is a single occurrence,
  // so callers can always iterate `Array.isArray(x) ? x : [x]`.
  isArray: () => false,
});

/**
 * Parse an XML payload, tolerating a leading BOM or non-XML preamble. Returns a
 * structured document on success or an explicit failure — never throws.
 */
export function parseXmlPayload(payload: string): XmlParseResult {
  const xmlStart = payload.indexOf("<");
  if (xmlStart === -1) {
    return { ok: false, error: "Payload does not contain XML." };
  }

  const xml = payload.slice(xmlStart).replace("﻿", "");
  try {
    const parsed = parser.parse(xml) as XmlValue;
    if (!isRecord(parsed)) {
      return { ok: false, error: "Parsed XML root is not an object." };
    }
    return { ok: true, document: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "XML payload could not be parsed.";
    return { ok: false, error: message };
  }
}

/**
 * All child elements of a tag that match `tagName`, as elements. Single
 * occurrences are wrapped into a one-element array so callers iterate uniformly.
 * Non-element children (text/attributes) are ignored here — use {@link xmlText}.
 */
export function xmlChildren(parent: XmlValue | undefined, tagName: string): readonly XmlElement[] {
  const element = asElement(parent);
  if (element === null) {
    return [];
  }
  const value = element[tagName];
  if (value === undefined) {
    return [];
  }
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.filter(isRecord);
}

/**
 * The first child element matching `tagName`, or null.
 */
export function xmlChild(parent: XmlValue | undefined, tagName: string): XmlElement | null {
  return xmlChildren(parent, tagName)[0] ?? null;
}

/**
 * The text content of a child element. Returns null when the child is absent or
 * holds no text (e.g. it is itself a nested element). Entities are decoded by
 * the parser; CDATA sections are returned as their literal content. Elements
 * that carry both attributes and text (e.g. `<guid isPermaLink="false">x</guid>`)
 * expose the text under a "#text" key, which is read here too.
 */
export function xmlText(parent: XmlValue | undefined, tagName: string): string | null {
  const element = asElement(parent);
  if (element === null) {
    return null;
  }
  const value = element[tagName];
  const text = textOf(value);
  if (text === null) {
    return null;
  }
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function textOf(value: XmlValue | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    const nested = value["#text"];
    return typeof nested === "string" ? nested : null;
  }
  return null;
}

/**
 * An attribute value on a child element. Reads `<tagName ... attributeName="x">`.
 */
export function xmlAttribute(parent: XmlValue | undefined, tagName: string, attributeName: string): string | null {
  const child = xmlChild(parent, tagName);
  if (child === null) {
    return null;
  }
  return xmlOwnAttribute(child, attributeName);
}

/**
 * An attribute value on the element itself (reads its `@_`-prefixed key).
 */
export function xmlOwnAttribute(element: XmlValue | null, attributeName: string): string | null {
  const record = asElement(element);
  if (record === null) {
    return null;
  }
  const value = record[`@_${attributeName}`];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function asElement(value: XmlValue | null | undefined): XmlElement | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: XmlValue | null | undefined): value is XmlElement {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
