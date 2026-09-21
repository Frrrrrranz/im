//! Incremental Server-Sent Events parser. Bytes go in (in whatever chunking
//! the network produced), complete events come out. Blank lines delimit
//! events, so we never split on lines first — that is exactly what loses them.

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

#[derive(Debug, Default)]
pub struct SseParser {
    buf: Vec<u8>,
    current: SseEvent,
    has_data: bool,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed a chunk; returns every event completed by it.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(nl) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=nl).collect();
            let mut line = &line[..nl];
            if line.last() == Some(&b'\r') {
                line = &line[..line.len() - 1];
            }
            if let Some(ev) = self.line(line) {
                out.push(ev);
            }
        }
        out
    }

    /// Flush a trailing event that wasn't followed by a blank line.
    pub fn finish(&mut self) -> Option<SseEvent> {
        if !self.buf.is_empty() {
            let rest = std::mem::take(&mut self.buf);
            let mut rest = &rest[..];
            if rest.last() == Some(&b'\r') {
                rest = &rest[..rest.len() - 1];
            }
            if let Some(ev) = self.line(rest) {
                return Some(ev);
            }
        }
        self.dispatch()
    }

    fn line(&mut self, line: &[u8]) -> Option<SseEvent> {
        if line.is_empty() {
            return self.dispatch();
        }
        if line[0] == b':' {
            return None; // comment / keep-alive
        }
        let (field, value) = match line.iter().position(|&b| b == b':') {
            Some(i) => {
                let v = &line[i + 1..];
                (
                    &line[..i],
                    if v.first() == Some(&b' ') { &v[1..] } else { v },
                )
            }
            None => (line, &line[line.len()..]),
        };
        let value = String::from_utf8_lossy(value);
        match field {
            b"event" => self.current.event = Some(value.into_owned()),
            b"data" => {
                if self.has_data {
                    self.current.data.push('\n');
                }
                self.current.data.push_str(&value);
                self.has_data = true;
            }
            _ => {} // id, retry, unknown fields
        }
        None
    }

    fn dispatch(&mut self) -> Option<SseEvent> {
        if !self.has_data && self.current.event.is_none() {
            return None;
        }
        self.has_data = false;
        Some(std::mem::take(&mut self.current))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(chunks: &[&str]) -> Vec<SseEvent> {
        let mut p = SseParser::new();
        let mut out = Vec::new();
        for c in chunks {
            out.extend(p.push(c.as_bytes()));
        }
        out.extend(p.finish());
        out
    }

    #[test]
    fn splits_on_blank_lines_across_chunks() {
        let evs = collect(&[
            "data: {\"a\":1}\n\nda",
            "ta: {\"b\":2}\n",
            "\ndata: [DONE]\n\n",
        ]);
        assert_eq!(evs.len(), 3);
        assert_eq!(evs[0].data, "{\"a\":1}");
        assert_eq!(evs[1].data, "{\"b\":2}");
        assert_eq!(evs[2].data, "[DONE]");
        assert!(evs.iter().all(|e| e.event.is_none()));
    }

    #[test]
    fn event_names_crlf_and_comments() {
        let evs = collect(&[
            ": keep-alive\r\n",
            "event: message_start\r\ndata: {\"x\":1}\r\n\r\n",
            "event: ping\r\ndata: {}\r\n\r\n",
        ]);
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0].event.as_deref(), Some("message_start"));
        assert_eq!(evs[0].data, "{\"x\":1}");
        assert_eq!(evs[1].event.as_deref(), Some("ping"));
    }

    #[test]
    fn multi_line_data_joins_with_newline() {
        let evs = collect(&["data: a\ndata: b\n\n"]);
        assert_eq!(evs[0].data, "a\nb");
    }

    #[test]
    fn trailing_event_without_blank_line_is_flushed() {
        let evs = collect(&["data: last"]);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].data, "last");
    }

    #[test]
    fn byte_at_a_time() {
        let text = "event: e\ndata: hello\n\n";
        let mut p = SseParser::new();
        let mut out = Vec::new();
        for b in text.as_bytes() {
            out.extend(p.push(&[*b]));
        }
        assert_eq!(
            out,
            vec![SseEvent {
                event: Some("e".into()),
                data: "hello".into()
            }]
        );
    }
}
