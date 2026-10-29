#!/usr/bin/env python3
"""Inspect, or create one missing A record. Credentials come only from AWS CLI.

The expected delegation was supplied for the public mitchellhynes.com domain.
This helper cannot change its zone/name/TTL and never uses UPSERT or DELETE.
"""

import argparse
import ipaddress
import json
import re
import subprocess
import sys

ZONE_NAME = "mitchellhynes.com."
RECORD_NAME = "office.mitchellhynes.com."
EXPECTED_NAMESERVERS = frozenset({
    "ns-1325.awsdns-37.org.",
    "ns-1630.awsdns-11.co.uk.",
    "ns-180.awsdns-22.com.",
    "ns-680.awsdns-21.net.",
})
TTL = 300


class Refused(RuntimeError):
    """The requested change is outside this helper's narrow contract."""


def dns_name(value):
    return value.rstrip(".").lower() + "." if isinstance(value, str) else ""


def zone_id(value):
    result = str(value).removeprefix("/hostedzone/")
    if not re.fullmatch(r"Z[A-Z0-9]+", result):
        raise Refused("AWS returned an unexpected hosted-zone identifier.")
    return result


def aws_cli(arguments):
    result = subprocess.run(
        ["aws", *arguments, "--output", "json", "--no-cli-pager"],
        capture_output=True, text=True, check=False, timeout=60,
    )
    if result.returncode:
        # Do not echo environment variables, credentials, or CLI diagnostics.
        raise Refused(f"AWS CLI {' '.join(arguments[:2])} failed (exit {result.returncode}).")
    return json.loads(result.stdout)


def public_zone_candidates(aws):
    arguments = ["route53", "list-hosted-zones-by-name", "--dns-name", ZONE_NAME, "--no-paginate"]
    candidates = []
    seen = set()
    while True:
        page = aws(arguments)
        candidates.extend(zone for zone in page.get("HostedZones", [])
                          if dns_name(zone.get("Name")) == ZONE_NAME
                          and zone.get("Config", {}).get("PrivateZone") is False)
        if not page.get("IsTruncated") or dns_name(page.get("NextDNSName")) != ZONE_NAME:
            return candidates
        marker = zone_id(page.get("NextHostedZoneId"))
        if marker in seen:
            raise Refused("Hosted-zone pagination repeated a marker.")
        seen.add(marker)
        arguments = ["route53", "list-hosted-zones-by-name", "--dns-name", ZONE_NAME,
                     "--hosted-zone-id", marker, "--no-paginate"]


def authoritative_zone(aws):
    matching = []
    for candidate in public_zone_candidates(aws):
        identifier = zone_id(candidate.get("Id"))
        details = aws(["route53", "get-hosted-zone", "--id", identifier])
        zone = details.get("HostedZone", {})
        if (dns_name(zone.get("Name")) != ZONE_NAME
                or zone.get("Config", {}).get("PrivateZone") is not False
                or zone_id(zone.get("Id")) != identifier):
            raise Refused("Hosted-zone details do not match the expected public zone.")
        nameservers = details.get("DelegationSet", {}).get("NameServers", [])
        normalized = [dns_name(value) for value in nameservers]
        if len(normalized) == 4 and frozenset(normalized) == EXPECTED_NAMESERVERS:
            matching.append({"id": identifier, "name": ZONE_NAME, "nameservers": sorted(normalized)})
    if len(matching) != 1:
        raise Refused(f"Expected exactly one public {ZONE_NAME} zone with the approved nameservers; found {len(matching)}.")
    return matching[0]


def office_records(aws, identifier):
    arguments = ["route53", "list-resource-record-sets", "--hosted-zone-id", identifier,
                 "--start-record-name", RECORD_NAME, "--no-paginate"]
    records = []
    seen = set()
    while True:
        page = aws(arguments)
        records.extend(record for record in page.get("ResourceRecordSets", [])
                       if dns_name(record.get("Name")) == RECORD_NAME)
        if not page.get("IsTruncated") or dns_name(page.get("NextRecordName")) != RECORD_NAME:
            return records
        marker = (page.get("NextRecordName"), page.get("NextRecordType"), page.get("NextRecordIdentifier"))
        if marker in seen or not marker[1]:
            raise Refused("Record pagination returned an invalid or repeated marker.")
        seen.add(marker)
        arguments = ["route53", "list-resource-record-sets", "--hosted-zone-id", identifier,
                     "--start-record-name", RECORD_NAME, "--start-record-type", marker[1], "--no-paginate"]
        if marker[2] is not None:
            arguments += ["--start-record-identifier", marker[2]]


def run(aws, ipv4="", emit=lambda value: None):
    value = ipv4.strip()
    if value:
        try:
            value = str(ipaddress.IPv4Address(value))
        except ipaddress.AddressValueError as error:
            raise Refused("ipv4 must be a single valid IPv4 address, or empty for inspection.") from error
    identity = aws(["sts", "get-caller-identity"])
    emit({"account": identity.get("Account"), "principal": identity.get("Arn")})
    zone = authoritative_zone(aws)
    records = office_records(aws, zone["id"])
    inspection = {"zone": zone, "recordName": RECORD_NAME, "currentRecords": records}
    emit(inspection)
    if not value:
        return {"result": "inspection-only", "changed": False}

    wanted = {"Name": RECORD_NAME, "Type": "A", "TTL": TTL, "ResourceRecords": [{"Value": value}]}
    if records:
        # An alias, weighted/failover record, different TTL/value, or any other
        # record at this name requires a separate explicit review.
        normalized = [{**record, "Name": dns_name(record.get("Name"))} for record in records]
        if normalized == [wanted]:
            return {"result": "already-identical", "changed": False, "record": wanted}
        raise Refused("office.mitchellhynes.com already has a different record; refusing to overwrite or add alongside it.")

    batch = {"Comment": "Create the explicitly requested Office IPv4 record", "Changes": [
        {"Action": "CREATE", "ResourceRecordSet": wanted},
    ]}
    # CREATE is also the final race guard: another writer creating this record
    # after inspection causes AWS to reject this request, never to overwrite it.
    response = aws(["route53", "change-resource-record-sets", "--hosted-zone-id", zone["id"],
                    "--change-batch", json.dumps(batch, separators=(",", ":"))])
    return {"result": "created", "changed": True, "record": wanted, "change": response.get("ChangeInfo")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ipv4", default="", help="Empty: inspect only. IPv4: create the missing Office A record.")
    arguments = parser.parse_args()
    emit = lambda value: print(json.dumps(value, sort_keys=True), flush=True)
    try:
        emit(run(aws_cli, arguments.ipv4, emit))
    except (Refused, OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        print(f"Refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
