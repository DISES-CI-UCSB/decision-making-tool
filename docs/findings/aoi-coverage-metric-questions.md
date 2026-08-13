# AOI coverage metric questions

This document defines the questions that the ecosystem and species coverage columns should answer. These are proposed shared column names for both custom and predefined areas of interest (AOIs); implementation parity will be handled separately after the wording and metric intent are confirmed.

## Ecosystem coverage

| Proposed column name | Question this metric answers |
| --- | --- |
| Ecosystem type | Which mapped ecosystem classification does this row describe? |
| km² of ecosystem type area in AOI | How many square kilometers of this ecosystem type occur inside the AOI? |
| Share of ecosystem type's national area in AOI | What percentage of this ecosystem type's total mapped area across the country falls inside the AOI? The denominator is the national mapped area of this same ecosystem type. |
| Share of total AOI area that is this ecosystem type | Of the AOI's total land area, what percentage is this ecosystem type? The denominator includes both classified and unclassified land inside the AOI. |
| Total solution coverage of ecosystem type in AOI | What percentage of this ecosystem type's area inside the AOI is covered by the solution? This is the sum of pre-existing coverage and newly prioritized coverage. |
| Pre-existing solution coverage of ecosystem area in AOI | What percentage of this ecosystem type's area inside the AOI was locked into the solution as pre-existing coverage? “Pre-existing” does not necessarily mean legally protected. |
| Newly prioritized solution coverage of ecosystem area in AOI | What percentage of this ecosystem type's area inside the AOI was newly selected by the prioritization analysis? |

## Species coverage

| Proposed column name | Question this metric answers |
| --- | --- |
| Species | Which modeled species range does this row describe? |
| Species range in AOI | How much of the species' modeled national range falls inside the AOI? This should show the area in square kilometers and its percentage of the species' total national modeled range. |
| Total solution coverage of species range in AOI | What percentage of the species' modeled range inside the AOI is covered by the solution? This is the sum of pre-existing coverage and newly prioritized coverage. |
| Pre-existing solution coverage of species range in AOI | What percentage of the species' modeled range inside the AOI was locked into the solution as pre-existing coverage? “Pre-existing” does not necessarily mean legally protected. |
| Newly prioritized solution coverage of species range in AOI | What percentage of the species' modeled range inside the AOI was newly selected by the prioritization analysis? |

The coverage percentages use the feature area inside the AOI as their denominator: ecosystem coverage is divided by that ecosystem type's area in the AOI, and species coverage is divided by that species' modeled range in the AOI.
