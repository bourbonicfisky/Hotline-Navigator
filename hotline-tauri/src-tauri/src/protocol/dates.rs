/// Decode the Hotline 8-byte date format (`year:2 | msecs:2 | secs:4`) into a
/// human-readable string. Per the fogWraith Capabilities spec, two wire formats
/// coexist:
///
/// - **Modern**: `year` is the actual year (e.g. 2026); `secs` is seconds since
///   00:00:00 on Jan 1 of that year.
/// - **Mac-1904 epoch**: `year == 1904`; `secs` is total seconds since
///   1904-01-01 00:00:00 UTC.
///
/// Servers select the modern format when capability bit 9 is negotiated. Vintage servers always send the 1904 form.
/// Returns `None` for sentinel values (year=0).
pub fn decode_hotline_date(year: u16, secs: u32) -> Option<String> {
    if year == 0 {
        return None;
    }

    let (resolved_year, secs_in_year) = if year == 1904 {
        let mut y: u32 = 1904;
        let mut remaining = secs;
        loop {
            let leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
            let year_secs: u32 = if leap { 366 * 86400 } else { 365 * 86400 };
            if remaining < year_secs {
                break;
            }
            remaining -= year_secs;
            y += 1;
        }
        (y as u16, remaining)
    } else {
        (year, secs)
    };

    let is_leap =
        (resolved_year % 4 == 0 && resolved_year % 100 != 0) || (resolved_year % 400 == 0);
    let days_in_months: [u32; 12] =
        [31, if is_leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let total_days = secs_in_year / 86400;
    let day_secs = secs_in_year % 86400;
    let hour = day_secs / 3600;
    let minute = (day_secs % 3600) / 60;
    let mut remaining = total_days;
    let mut month = 0u32;
    for (i, &dim) in days_in_months.iter().enumerate() {
        if remaining < dim {
            month = i as u32 + 1;
            break;
        }
        remaining -= dim;
    }
    if month == 0 {
        return None;
    }
    let day = remaining + 1;
    let ampm = if hour < 12 { "AM" } else { "PM" };
    let h12 = if hour == 0 {
        12
    } else if hour > 12 {
        hour - 12
    } else {
        hour
    };
    Some(format!("{}/{}/{} {}:{:02} {}", month, day, resolved_year, h12, minute, ampm))
}

/// Decode an entire field; malformed widths and absent dates remain unknown.
pub fn decode_date_field(data: &[u8]) -> Option<String> {
    if data.len() != 8 { return None; }
    decode_hotline_date(u16::from_be_bytes([data[0], data[1]]),
        u32::from_be_bytes([data[4], data[5], data[6], data[7]]))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_dates_support_both_encodings_and_unknown_values() {
        let modern = [0x07, 0xEA, 0, 0, 0, 0, 0, 0];
        assert_eq!(decode_date_field(&modern).as_deref(), Some("1/1/2026 12:00 AM"));
        let mut legacy = vec![0x07, 0x70, 0, 0];
        legacy.extend_from_slice(&3_850_070_400u32.to_be_bytes());
        assert_eq!(decode_date_field(&legacy), decode_date_field(&modern));
        assert_eq!(decode_date_field(&[0; 8]), None);
        assert_eq!(decode_date_field(&[0; 4]), None);
        assert_eq!(decode_hotline_date(2026, 400 * 86400), None);
        assert_eq!(decode_hotline_date(1904, 0).as_deref(), Some("1/1/1904 12:00 AM"));
    }
}
