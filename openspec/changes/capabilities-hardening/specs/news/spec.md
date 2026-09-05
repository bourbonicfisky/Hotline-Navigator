## ADDED Requirements

### Requirement: Threaded news article date decoding

The client SHALL decode the 8-byte date field (`year:2 | msecs:2 | secs:4`) carried in threaded news article listings, supporting both the Mac-1904 epoch format and the modern format, distinguishing the two by the value of the `year` field.

When `year == 1904`, the `secs` field SHALL be interpreted as total seconds since 1904-01-01 00:00:00 UTC. The client SHALL convert this to a calendar date by adding `secs` seconds to the 1904 epoch.

When `year != 1904` and `year > 0`, the `secs` field SHALL be interpreted as seconds since 00:00:00 on January 1 of that year (local time on the server, treated as UTC by the client absent better information). The client SHALL compute month/day/hour/minute by month-walking through the year, accounting for leap years.

When `year == 0` or the field is absent, the client SHALL render the article without a date.

Servers select modern dates using capability bit 9 alone. The client SHALL advertise this bit and continue accepting Mac-1904 dates from legacy servers. Year zero is unknown; zero seconds with a nonzero year is a valid date.

#### Scenario: Modern format date

- **WHEN** an article date has `year=2026, msecs=0, secs=0`
- **THEN** the client SHALL render the date as `1/1/2026 12:00 AM`

#### Scenario: Mac-1904 epoch date

- **WHEN** an article date has `year=1904, msecs=0, secs=3_881_390_400` (≈ 2027-01-01 UTC)
- **THEN** the client SHALL convert by adding 3,881,390,400 seconds to 1904-01-01 and render the resulting calendar date

#### Scenario: Year-zero sentinel

- **WHEN** an article date has `year=0`
- **THEN** the client SHALL render the article without a date (no sentinel string substituted)

#### Scenario: 1904 boundary

- **WHEN** an article date has `year=1904, secs=0`
- **THEN** the client SHALL render `1/1/1904 12:00 AM`
