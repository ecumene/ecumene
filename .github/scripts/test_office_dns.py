import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location("office_dns", Path(__file__).with_name("office-dns.py"))
dns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dns)


def public_zone(identifier="ZOFFICE", name=dns.ZONE_NAME, private=False):
    return {"Id": f"/hostedzone/{identifier}", "Name": name, "Config": {"PrivateZone": private}}


def record(value="203.0.113.17", **changes):
    return {"Name": dns.RECORD_NAME, "Type": "A", "TTL": 300, "ResourceRecords": [{"Value": value}], **changes}


class Fixture:
    def __init__(self, records=None, zones=None, nameservers=None):
        self.records = records or []
        self.zones = zones if zones is not None else [public_zone()]
        self.nameservers = nameservers if nameservers is not None else list(dns.EXPECTED_NAMESERVERS)
        self.details_override = None
        self.aws = Mock(side_effect=self.respond)

    def respond(self, args):
        command = args[:2]
        if command == ["sts", "get-caller-identity"]:
            return {"Account": "123456789012", "Arn": "arn:aws:iam::123456789012:user/synthetic"}
        if command == ["route53", "list-hosted-zones-by-name"]:
            return {"HostedZones": copy.deepcopy(self.zones), "IsTruncated": False}
        if command == ["route53", "get-hosted-zone"]:
            identifier = args[args.index("--id") + 1]
            return {"HostedZone": self.details_override or public_zone(identifier), "DelegationSet": {"NameServers": self.nameservers}}
        if command == ["route53", "list-resource-record-sets"]:
            return {"ResourceRecordSets": copy.deepcopy(self.records), "IsTruncated": False}
        if command == ["route53", "change-resource-record-sets"]:
            return {"ChangeInfo": {"Id": "/change/SYNTHETIC", "Status": "PENDING"}}
        raise AssertionError(f"Unexpected AWS operation: {args}")

    def writes(self):
        return [call.args[0] for call in self.aws.call_args_list if call.args[0][:2] == ["route53", "change-resource-record-sets"]]


class OfficeDNSTest(unittest.TestCase):
    def test_empty_input_inspects_identity_exact_zone_and_all_office_records_without_writes(self):
        f = Fixture([record(), {"Name": "other.mitchellhynes.com.", "Type": "A", "TTL": 300, "ResourceRecords": [{"Value": "203.0.113.99"}]}])
        output = []
        result = dns.run(f.aws, "", output.append)
        self.assertEqual(result, {"result": "inspection-only", "changed": False})
        self.assertEqual(output[0]["account"], "123456789012")
        self.assertEqual(output[1]["zone"]["name"], dns.ZONE_NAME)
        self.assertEqual(output[1]["currentRecords"], [record()])
        self.assertEqual(set(output[1]["zone"]["nameservers"]), dns.EXPECTED_NAMESERVERS)
        self.assertEqual(f.writes(), [])

    def test_create_is_one_A_record_only_with_fixed_name_TTL_and_approved_zone(self):
        f = Fixture()
        result = dns.run(f.aws, "203.0.113.17")
        self.assertTrue(result["changed"])
        self.assertEqual(len(f.writes()), 1)
        args = f.writes()[0]
        self.assertEqual(args[args.index("--hosted-zone-id") + 1], "ZOFFICE")
        batch = json.loads(args[args.index("--change-batch") + 1])
        self.assertEqual(batch["Changes"], [{"Action": "CREATE", "ResourceRecordSet": record()}])

    def test_identical_A_is_a_noop(self):
        f = Fixture([record()])
        self.assertEqual(dns.run(f.aws, "203.0.113.17")["result"], "already-identical")
        self.assertEqual(f.writes(), [])

    def test_conflicting_record_shapes_refuse_without_a_write(self):
        cases = [
            [record("203.0.113.18")], [record(TTL=60)],
            [record(ResourceRecords=[{"Value": "203.0.113.17"}, {"Value": "203.0.113.18"}])],
            [{"Name": dns.RECORD_NAME, "Type": "CNAME", "TTL": 300, "ResourceRecords": [{"Value": "example.com."}]}],
            [record(SetIdentifier="weighted", Weight=10)],
            [{"Name": dns.RECORD_NAME, "Type": "A", "AliasTarget": {"HostedZoneId": "ZOTHER", "DNSName": "example.com.", "EvaluateTargetHealth": False}}],
            [record(), {"Name": dns.RECORD_NAME, "Type": "TXT", "TTL": 300, "ResourceRecords": [{"Value": '"existing"'}]}],
        ]
        for existing in cases:
            with self.subTest(existing=existing):
                f = Fixture(existing)
                with self.assertRaises(dns.Refused): dns.run(f.aws, "203.0.113.17")
                self.assertEqual(f.writes(), [])

    def test_private_unrelated_and_non_authoritative_zones_are_never_used(self):
        fixtures = [
            Fixture(zones=[public_zone(private=True)]),
            Fixture(zones=[public_zone(name="example.com.")]),
            Fixture(nameservers=["ns1.example.com."]),
            Fixture(zones=[]),
        ]
        for f in fixtures:
            with self.subTest(zones=f.zones, ns=f.nameservers):
                with self.assertRaises(dns.Refused): dns.run(f.aws, "203.0.113.17")
                self.assertEqual(f.writes(), [])

    def test_ambiguous_matching_zones_refuse(self):
        f = Fixture(zones=[public_zone("ZONE"), public_zone("ZTWO")])
        with self.assertRaises(dns.Refused): dns.run(f.aws, "203.0.113.17")
        self.assertEqual(f.writes(), [])

    def test_zone_details_are_revalidated_before_record_access(self):
        for details in [public_zone(name="other.com."), public_zone(private=True), public_zone("ZDIFFERENT")]:
            with self.subTest(details=details):
                f = Fixture(); f.details_override = details
                with self.assertRaises(dns.Refused): dns.run(f.aws, "203.0.113.17")
                self.assertFalse(any(call.args[0][1] == "list-resource-record-sets" for call in f.aws.call_args_list))
                self.assertEqual(f.writes(), [])

    def test_invalid_or_injected_IPv4_is_rejected_before_any_AWS_call(self):
        for value in ["::1", "203.0.113.17/24", "1.2.3.999", "example.com", "1.2.3.4; echo unsafe", "1.2.3.04"]:
            with self.subTest(value=value):
                f = Fixture()
                with self.assertRaises(dns.Refused): dns.run(f.aws, value)
                f.aws.assert_not_called()

    def test_record_pagination_cannot_hide_a_conflicting_same_name_record(self):
        f = Fixture()
        ordinary = f.respond
        pages = iter([
            {"ResourceRecordSets": [record()], "IsTruncated": True, "NextRecordName": dns.RECORD_NAME, "NextRecordType": "TXT"},
            {"ResourceRecordSets": [{"Name": dns.RECORD_NAME, "Type": "TXT", "TTL": 300, "ResourceRecords": [{"Value": '"existing"'}]}], "IsTruncated": False},
        ])
        f.aws.side_effect = lambda args: next(pages) if args[1] == "list-resource-record-sets" else ordinary(args)
        with self.assertRaises(dns.Refused): dns.run(f.aws, "203.0.113.17")
        self.assertEqual(f.writes(), [])

    def test_create_race_failure_is_not_retried_as_an_overwrite(self):
        f = Fixture()
        ordinary = f.respond
        def race(args):
            if args[1] == "change-resource-record-sets": raise dns.Refused("Record was created concurrently.")
            return ordinary(args)
        f.aws.side_effect = race
        with self.assertRaises(dns.Refused): dns.run(f.aws, "203.0.113.17")
        self.assertEqual(len(f.writes()), 1)
        self.assertEqual(json.loads(f.writes()[0][-1])["Changes"][0]["Action"], "CREATE")


if __name__ == "__main__":
    unittest.main()
