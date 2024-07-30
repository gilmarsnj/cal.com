import { useEffect, useState } from "react";
import type { ZodSchema } from "zod";
import { z as _z, z } from "zod";

import { useBookerStore } from "@calcom/features/bookings/Booker/store";
import type getBookingResponsesSchema from "@calcom/features/bookings/lib/getBookingResponsesSchema";
import { getBookingResponsesPartialSchema } from "@calcom/features/bookings/lib/getBookingResponsesSchema";
import type { BookerEvent } from "@calcom/features/bookings/types";
import type { RouterOutputs } from "@calcom/trpc/react";

export type useInitialFormValuesReturnType = ReturnType<typeof useInitialFormValues>;

type Field = NonNullable<RouterOutputs["viewer"]["public"]["event"]>["bookingFields"][number];

type UseInitialFormValuesProps = {
  eventType?: Pick<BookerEvent, "bookingFields"> | null;
  rescheduleUid: string | null;
  isRescheduling: boolean;
  email?: string | null;
  name?: string | null;
  username?: string | null;
  hasSession: boolean;
  extraOptions: Record<string, string | string[]>;
  prefillFormParams: {
    guests: string[];
    name: string | null;
  };
};

//basically it will partially test the input values against the schema. validation are not needed at the initial stage
export function getFieldSchema(field: Field): ZodSchema<unknown> {
  switch (field.type) {
    case "name":
      return _z.string().optional();
    case "email":
      return _z.string().optional();
    case "text":
      return _z.string().optional();
    case "textarea":
      return _z.string().optional();
    case "multiemail":
      return _z.union([_z.string(), _z.array(_z.string())]).optional();
    case "address":
      return _z.string().optional();
    case "phone":
      return _z
        .string()
        .regex(/^\+?[0-9]*$/, { message: "Invalid phone number" })
        .optional();
    case "number":
      return _z
        .string()
        .refine((val) => !isNaN(Number(val)), { message: "Invalid number" })
        .transform((val) => Number(val))
        .optional();
    case "boolean":
      return _z
        .string()
        .refine((val) => val === "true" || val === "false", { message: "Invalid boolean" })
        .transform((val) => val === "true")
        .optional();
    case "radioInput":
    case "select":
    case "radio":
      if (field.options && field.options.length > 0) {
        const values = field.options.map((opt) => opt.value) as [string, ...string[]];
        return _z.union([_z.enum(values), _z.string()]).optional();
      } else {
        return _z.any().optional();
      }
    case "multiselect":
    case "checkbox":
      if (field.options && field.options.length > 0) {
        const validValues = field.options.map((opt) => opt.value) as [string, ...string[]];
        return z
          .union([
            z
              .array(z.string())
              .refine((arr) => arr.some((val) => validValues.includes(val)), {
                message: "Invalid option in array",
              })
              .transform((arr) => arr.filter((val) => validValues.includes(val))),

            z
              .string()
              .refine((val) => validValues.includes(val), {
                message: "Invalid single option",
              })
              .optional(),
          ])
          .optional();
      } else {
        return _z.union([_z.array(_z.string()).optional(), _z.string()]).optional();
      }
    // Add more cases as needed
    default:
      return _z.any().optional();
  }
}

export function checkParseQueryValues(field: Field, parsedQuery: Record<string, unknown> | undefined) {
  if (!parsedQuery || !field) return { ignore: true };

  if (!parsedQuery[field.name]) {
    return { ignore: true };
  }

  const schema = getFieldSchema(field);
  if (!schema) return { ignore: true };
  const parsedResponses = schema.safeParse(parsedQuery[field.name]);
  return { success: parsedResponses.success, value: parsedResponses?.data };
}

export function useInitialFormValues({
  eventType,
  rescheduleUid,
  isRescheduling,
  email,
  name,
  username,
  hasSession,
  extraOptions,
  prefillFormParams,
}: UseInitialFormValuesProps) {
  const [initialValues, setDefaultValues] = useState<{
    responses?: Partial<z.infer<ReturnType<typeof getBookingResponsesSchema>>>;
    bookingId?: number;
  }>({});
  const bookingData = useBookerStore((state) => state.bookingData);
  const formValues = useBookerStore((state) => state.formValues);

  //currently while initializing the form we are checking if the query params are valid and if not, we are returning default values

  useEffect(() => {
    (async function () {
      if (Object.keys(formValues).length) {
        setDefaultValues(formValues);
        return;
      }

      if (!eventType?.bookingFields) {
        return {};
      }
      const querySchema = getBookingResponsesPartialSchema({
        bookingFields: eventType.bookingFields,
        view: rescheduleUid ? "reschedule" : "booking",
      });

      const parsedQuery = await querySchema.parseAsync({
        ...extraOptions,
        name: prefillFormParams.name,
        // `guest` because we need to support legacy URL with `guest` query param support
        // `guests` because the `name` of the corresponding bookingField is `guests`
        guests: prefillFormParams.guests,
      });

      const defaultUserValues = {
        email:
          rescheduleUid && bookingData && bookingData.attendees.length > 0
            ? bookingData?.attendees[0].email
            : !!parsedQuery["email"]
            ? parsedQuery["email"]
            : email ?? "",
        name:
          rescheduleUid && bookingData && bookingData.attendees.length > 0
            ? bookingData?.attendees[0].name
            : !!parsedQuery["name"]
            ? parsedQuery["name"]
            : name ?? username ?? "",
      };

      if (!isRescheduling) {
        const defaults = {
          responses: {} as Partial<z.infer<ReturnType<typeof getBookingResponsesSchema>>>,
        };

        const responses = eventType.bookingFields.reduce((responses, field) => {
          const result = checkParseQueryValues(field, parsedQuery);
          let value;
          if (result.success) {
            value = result.value || undefined;
          }
          return {
            ...responses,
            [field.name]: value,
          };
        }, {});

        defaults.responses = {
          ...responses,
          name: defaultUserValues.name,
          email: defaultUserValues.email,
        };

        setDefaultValues(defaults);
      }

      if (!rescheduleUid && !bookingData) {
        return {};
      }

      // We should allow current session user as default values for booking form

      const defaults = {
        responses: {} as Partial<z.infer<ReturnType<typeof getBookingResponsesSchema>>>,
        bookingId: bookingData?.id,
      };

      const responses = eventType.bookingFields.reduce((responses, field) => {
        const result = checkParseQueryValues(field, parsedQuery);
        let value;
        if (result.success) {
          value = result.value || undefined;
        }
        return {
          ...responses,
          [field.name]: value,
        };
      }, {});
      defaults.responses = {
        ...responses,
        name: defaultUserValues.name,
        email: defaultUserValues.email,
      };
      setDefaultValues(defaults);
    })();
    // do not add extraOptions as a dependency, it will cause infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    eventType?.bookingFields,
    formValues,
    isRescheduling,
    bookingData,
    bookingData?.id,
    rescheduleUid,
    email,
    name,
    username,
    prefillFormParams,
  ]);

  // When initialValues is available(after doing async schema parsing) or session is available(so that we can prefill logged-in user email and name), we need to reset the form with the initialValues
  // We also need the key to change if the bookingId changes, so that the form is reset and rerendered with the new initialValues
  const key = `${Object.keys(initialValues).length}_${hasSession ? 1 : 0}_${initialValues?.bookingId ?? 0}`;

  return { initialValues, key };
}
