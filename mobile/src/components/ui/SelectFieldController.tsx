import { Control, Controller, FieldPath, FieldValues } from "react-hook-form";

import { SelectField, SelectFieldProps } from "./SelectField";

type Props<T extends FieldValues> = Omit<SelectFieldProps, "value" | "onChange" | "error"> & {
  control: Control<T>;
  name: FieldPath<T>;
};

/** React Hook Form wrapper for SelectField — mirrors TextField error conventions. */
export function SelectFieldController<T extends FieldValues>({ control, name, ...rest }: Props<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value }, fieldState: { error } }) => (
        <SelectField
          {...rest}
          value={value == null || value === "" ? null : String(value)}
          onChange={onChange}
          error={error?.message}
        />
      )}
    />
  );
}
