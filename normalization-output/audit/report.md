# Budget data normalization audit

Generated 2026-08-24T22:07:16.376Z.

## Executive summary

The run normalized 45,823 rows across 3 datasets and recorded 301,925 individual transformations and derivations. Every transformation is listed in `changes-with-provenance.csv` with the source row ID and before/after value.

No rows were added, removed, merged, or deduplicated. Dollar values were not rewritten, and each dataset total is identical before and after normalization.

| Dataset | Rows | Source total | Audit entries | Label mappings applied |
| --- | ---: | ---: | ---: | ---: |
| Budget - Operating Expenditures | 41,384 | $11,621,453,336.00 | 272,829 | 60,304 |
| Budget - Operating Revenues | 3,730 | $11,621,453,317.00 | 23,592 | 3,579 |
| Budget - Capital | 709 | $1,806,146,613.00 | 5,504 | 418 |

## Source reconciliation findings

The operating datasets do not balance exactly in the two source years below. The normalized files preserve these published differences for Budget Office review.

| Fiscal year | Expenditures | Revenues | Expenditures minus revenues |
| --- | ---: | ---: | ---: |
| FY2014 | $507,186,337.00 | $507,186,335.00 | $2.00 |
| FY2015 | $524,401,817.00 | $524,401,800.00 | $17.00 |

## What changed

| Change class | Count | Meaning |
| --- | ---: | --- |
| Numeric type normalization | 91,904 | Socrata JSON numeric strings became JSON numbers. |
| Explicit nulls | 2,316 | Missing optional keys became explicit `null` values for a stable schema. |
| Comparison-field derivations | 181,874 | Published labels were copied or mapped into parallel cross-year comparison fields. |
| Typo/format corrections | 25,429 | Unambiguous spelling, capitalization, punctuation, or formatting errors were corrected directly. |
| Whitespace cleanup | 402 | Leading/trailing whitespace was removed and repeated whitespace collapsed. |

## Exact label mappings applied

| Dataset | Field | Published value | Comparison/corrected value | Rule class | Rows |
| --- | --- | --- | --- | --- | ---: |
| capital | city_location | 125 6th street | 125 6th Street | typo_or_format | 2 |
| capital | city_location | 1640 Cambridge st. | 1640 Cambridge St. | typo_or_format | 1 |
| capital | city_location | 250 Freshpond Parkway | 250 Fresh Pond Parkway | typo_or_format | 22 |
| capital | city_location | 99 Sherman Street. | 99 Sherman Street | typo_or_format | 2 |
| capital | department_comparison | Cable Television | Cable TV | deliberate_rename | 4 |
| capital | department_comparison | Fire | Fire Department | deliberate_rename | 9 |
| capital | department_comparison | Police | Police Department | deliberate_rename | 5 |
| capital | department_comparison | Public Celebrations | Arts Council | deliberate_rename | 3 |
| capital | department_comparison | Public Works - Planning & Administration | Public Works | organizational_crosswalk | 45 |
| capital | department_comparison | Public Works - Service Programs | Public Works | organizational_crosswalk | 50 |
| capital | department_comparison | Public Works - Support Services | Public Works | organizational_crosswalk | 25 |
| capital | department_comparison | Public Works Planning & Administration | Public Works | organizational_crosswalk | 100 |
| capital | department_comparison | School | School Organization | deliberate_rename | 11 |
| capital | department_comparison | Traffic, Parking, & Transportation | Transportation | deliberate_rename | 25 |
| capital | department_comparison | Water | Water Department | deliberate_rename | 52 |
| capital | fund | Non Capital Public Invest Appr | Non Capital Public Invt Appr | typo_or_format | 59 |
| capital | project_name | CDD Transportation-Electric Vehicle Charging Infrastructure | CDD: Transportation - Electric Vehicle Charging Infrastructure | typo_or_format | 1 |
| capital | project_name | CDD: HOUSING - AFFORDABLE HOUSING PROJECT DEVELOPMENT | CDD: Housing - Affordable Housing Project Development | typo_or_format | 1 |
| capital | project_name | CDD: Transportation - ebikes for Bluebikes | CDD: Transportation - Ebikes for Bluebikes | typo_or_format | 1 |
| expenditures | category | Salaries and Wages | Salaries & Wages | typo_or_format | 19,732 |
| expenditures | category | Travel and Training | Travel & Training | typo_or_format | 3,142 |
| expenditures | department_name_comparison | Animal Commission | Animal Control | deliberate_rename | 269 |
| expenditures | department_name_comparison | Cable Television | Cable TV | deliberate_rename | 310 |
| expenditures | department_name_comparison | Cherry Sheet | Cherry Sheet Assessments | deliberate_rename | 86 |
| expenditures | department_name_comparison | Commission on the Status of Women | Women's Commission | deliberate_rename | 200 |
| expenditures | department_name_comparison | Education | School Organization | deliberate_rename | 9,664 |
| expenditures | department_name_comparison | Election Commission | Election | deliberate_rename | 553 |
| expenditures | department_name_comparison | Fire | Fire Department | deliberate_rename | 2,195 |
| expenditures | department_name_comparison | Human Rights Commission | Human Rights | deliberate_rename | 244 |
| expenditures | department_name_comparison | Massachusetts Water Resources Authority | MWRA | deliberate_rename | 16 |
| expenditures | department_name_comparison | Police | Police Department | deliberate_rename | 2,080 |
| expenditures | department_name_comparison | Public Celebrations | Arts Council | deliberate_rename | 328 |
| expenditures | department_name_comparison | Public Works - Planning & Administration | Public Works | organizational_crosswalk | 29 |
| expenditures | department_name_comparison | Public Works - Service Programs | Public Works | organizational_crosswalk | 51 |
| expenditures | department_name_comparison | Public Works - Support Services | Public Works | organizational_crosswalk | 31 |
| expenditures | department_name_comparison | Traffic, Parking, and Transportation | Transportation | deliberate_rename | 1,270 |
| expenditures | department_name_comparison | Veterans Services | Veteran's Administration | deliberate_rename | 11 |
| expenditures | department_name_comparison | Veterans' Services | Veteran's Administration | deliberate_rename | 189 |
| expenditures | department_name_comparison | Water | Water Department | deliberate_rename | 1,090 |
| expenditures | description | Repairs and Maint - Services | Repairs and Maint (Services) | typo_or_format | 150 |
| expenditures | description | Repairs and Maint - Supplies | Repairs and Maint (Supplies) | typo_or_format | 171 |
| expenditures | division_name | Amigos school | Amigos School | typo_or_format | 12 |
| expenditures | division_name | Buisness Services | Business Services | typo_or_format | 6 |
| expenditures | division_name | Campbridgeport School | Cambridgeport School | typo_or_format | 50 |
| expenditures | division_name | Domestic and Gender-Based Violence Prevention Initiative | Domestic & Gender-Based Violence Prevention Initiative | typo_or_format | 9 |
| expenditures | division_name | Englis Language Learner Program | English Language Learner Program | typo_or_format | 12 |
| expenditures | division_name | Fletchard/Maynard Academy | Fletcher/Maynard Academy | typo_or_format | 190 |
| expenditures | division_name | Govermental Relations | Governmental Relations | typo_or_format | 7 |
| expenditures | division_name | Graham and Parks School | Graham & Parks School | typo_or_format | 107 |
| expenditures | division_name | Health and Physical Education | Health & Physical Education | typo_or_format | 59 |
| expenditures | division_name | History and Social Science | History & Social Science | typo_or_format | 48 |
| expenditures | division_name | Leadership Operations & IT | Leadership, Operations & IT | typo_or_format | 21 |
| expenditures | division_name | Legal Council | Legal Counsel | typo_or_format | 6 |
| expenditures | division_name | Other Post Employment Benefits | Other Post-Employment Benefits | typo_or_format | 5 |
| expenditures | division_name | Planning and Development | Planning & Development | typo_or_format | 270 |
| expenditures | division_name | Revenue & Treasury | Revenue Treasury | typo_or_format | 18 |
| expenditures | division_name | Safety and Security | Safety & Security | typo_or_format | 21 |
| expenditures | division_name | Transportation Planning | Transportation - Planning | typo_or_format | 23 |
| expenditures | division_name | Visual and Performing Arts | Visual & Performing Arts | typo_or_format | 65 |
| expenditures | division_name | World Language3s | World Languages | typo_or_format | 4 |
| expenditures | fund_comparison | School Fund | School General Fund | deliberate_rename | 40 |
| expenditures | fund_comparison | Water Fund | Water Funds | deliberate_rename | 1,026 |
| expenditures | service_comparison | Community Maintenance and Development | Community Maintenance | deliberate_rename | 6,539 |
| expenditures | service_comparison | Human Resource Development | Human Resource | deliberate_rename | 3,216 |
| expenditures | service_comparison | Human Resources and Development | Human Resource | deliberate_rename | 6,739 |
| revenues | category | Charges For Services | Charges for Service | typo_or_format | 954 |
| revenues | category | Fines & Forfeits | Fines and Forfeits | typo_or_format | 226 |
| revenues | department_name_comparison | Animal Commission | Animal Control | deliberate_rename | 76 |
| revenues | department_name_comparison | Cable Television | Cable TV | deliberate_rename | 32 |
| revenues | department_name_comparison | Cherry Sheet | Cherry Sheet Assessments | deliberate_rename | 63 |
| revenues | department_name_comparison | Commission on the Status of Women | Women's Commission | deliberate_rename | 32 |
| revenues | department_name_comparison | DHSP | Human Services | deliberate_rename | 65 |
| revenues | department_name_comparison | Education | School Organization | deliberate_rename | 138 |
| revenues | department_name_comparison | Election Commission | Election | deliberate_rename | 54 |
| revenues | department_name_comparison | Fire | Fire Department | deliberate_rename | 125 |
| revenues | department_name_comparison | Human Rights Commission | Human Rights | deliberate_rename | 16 |
| revenues | department_name_comparison | Massachusetts Water Resources Authority | MWRA | deliberate_rename | 16 |
| revenues | department_name_comparison | Police | Police Department | deliberate_rename | 249 |
| revenues | department_name_comparison | Public Celebrations | Arts Council | deliberate_rename | 54 |
| revenues | department_name_comparison | Public Works - Planning & Administration | Public Works | organizational_crosswalk | 9 |
| revenues | department_name_comparison | Public Works - Support Services | Public Works | organizational_crosswalk | 2 |
| revenues | department_name_comparison | Traffic, Parking, and Transportation | Transportation | deliberate_rename | 73 |
| revenues | department_name_comparison | Veterans Services | Veteran's Administration | deliberate_rename | 2 |
| revenues | department_name_comparison | Veterans' Services | Veteran's Administration | deliberate_rename | 37 |
| revenues | department_name_comparison | Water | Water Department | deliberate_rename | 57 |
| revenues | description | Rent Of City Property | Rent of City Property | typo_or_format | 31 |
| revenues | description | Short Term Rental Community Impact Fee | Short-Term Rental Community Impact Fee | typo_or_format | 1 |
| revenues | fund_comparison | School Fund | School General Fund | deliberate_rename | 85 |
| revenues | fund_comparison | Water Fund | Water Funds | deliberate_rename | 81 |
| revenues | service_comparison | Community Maintenance and Development | Community Maintenance | deliberate_rename | 746 |
| revenues | service_comparison | Human Resource Development | Human Resource | deliberate_rename | 86 |
| revenues | service_comparison | Human Resources and Development | Human Resource | deliberate_rename | 269 |

## Items deliberately left for Budget Office review

34 label spans begin after or end before their dataset range. They are listed in `label-span-review.csv`; the script did not guess at them. Many are legitimate new programs, ended programs, reorganizations, or changes in publication detail.

The script also leaves valid negative revenue rows, zero-dollar budget lines, optional capital locations, and the FY2026 employee-benefit centralization untouched.

| Dataset | Zero-dollar rows | Negative-dollar rows | Review-only label spans |
| --- | ---: | ---: | ---: |
| Budget - Operating Expenditures | 2,074 | 10 | 12 |
| Budget - Operating Revenues | 12 | 56 | 13 |
| Budget - Capital | 80 | 0 | 9 |

## Audit files

- `changes-with-provenance.csv` is the complete, row-level record of every transformation.
- `summary.json` is the machine-readable version of this report.
- `label-span-review.csv` lists possible continuity issues that were not automatically changed.
- `../manifest.json` records source URLs, update timestamps, row counts, checksums, and output files.
- `../normalized/*.json` contains the normalized row-level datasets.

The plain-English decision rules are in `docs/data-normalization-rules.md`.
