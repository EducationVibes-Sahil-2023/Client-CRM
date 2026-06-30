<?php

namespace App\Libraries;

/**
 * Sanitises user-authored rich text (announcements, task descriptions, email
 * signatures) before it's stored and later rendered as HTML on the client.
 *
 * Allow-list based (DOMDocument): only a safe set of formatting tags/attributes
 * survives; <script>/<style>/<iframe>/event handlers/javascript: URLs and any
 * unknown tag are removed. This stops stored XSS while keeping basic formatting.
 */
class HtmlSanitizer
{
    /** Formatting tags that are kept. */
    private const ALLOWED_TAGS = [
        'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'mark', 'sub', 'sup',
        'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'blockquote', 'code', 'pre', 'span', 'div', 'hr',
        'table', 'thead', 'tbody', 'tr', 'td', 'th',
    ];

    /** Attributes kept on surviving tags (href is additionally URL-checked). */
    private const ALLOWED_ATTRS = ['href', 'title', 'target', 'rel', 'colspan', 'rowspan'];

    /** Tags removed together with their contents (never just unwrapped). */
    private const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'svg', 'math', 'noscript'];

    /** Return sanitised HTML, or null for null input, '' for empty/whitespace. */
    public static function clean(?string $html): ?string
    {
        if ($html === null) {
            return null;
        }
        $html = trim($html);
        if ($html === '') {
            return '';
        }

        $doc = new \DOMDocument();
        $prev = libxml_use_internal_errors(true);
        // Wrap so we get a single root to walk; force UTF-8.
        $doc->loadHTML(
            '<?xml encoding="UTF-8"><body><div id="__root__">' . $html . '</div></body>',
            \LIBXML_NOERROR | \LIBXML_NOWARNING,
        );
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        $root = $doc->getElementById('__root__');
        if (! $root) {
            return '';
        }

        self::cleanChildren($root);

        $out = '';
        foreach (iterator_to_array($root->childNodes) as $child) {
            $out .= $doc->saveHTML($child);
        }

        return trim($out);
    }

    /** Recursively clean a node's children (depth-first; mutates the tree). */
    private static function cleanChildren(\DOMNode $node): void
    {
        foreach (iterator_to_array($node->childNodes) as $child) {
            if ($child instanceof \DOMComment) {
                $child->parentNode->removeChild($child);
                continue;
            }
            if (! ($child instanceof \DOMElement)) {
                continue; // text nodes are safe (DOM escapes them on save)
            }

            $tag = strtolower($child->tagName);

            if (in_array($tag, self::DROP_WITH_CONTENT, true)) {
                $child->parentNode->removeChild($child);
                continue;
            }

            if (! in_array($tag, self::ALLOWED_TAGS, true)) {
                // Unknown formatting tag → keep its (cleaned) contents, drop the tag.
                self::cleanChildren($child);
                while ($child->firstChild) {
                    $node->insertBefore($child->firstChild, $child);
                }
                $node->removeChild($child);
                continue;
            }

            // Strip every attribute except the allow-list; URL-check href.
            foreach (iterator_to_array($child->attributes) as $attr) {
                $name = strtolower($attr->name);
                if (! in_array($name, self::ALLOWED_ATTRS, true)) {
                    $child->removeAttribute($attr->name);
                    continue;
                }
                if (($name === 'href') && preg_match('/^\s*(javascript|vbscript|data)\s*:/i', (string) $attr->value)) {
                    $child->removeAttribute($attr->name);
                }
            }
            // Links that open a new tab shouldn't leak the opener.
            if ($tag === 'a' && $child->getAttribute('target') === '_blank') {
                $child->setAttribute('rel', 'noopener noreferrer');
            }

            self::cleanChildren($child);
        }
    }
}
