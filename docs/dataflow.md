# Dataflow in Shortcuts

Shortcuts is not only a sequence of actions. It also carries a current value through that sequence. Understanding that implicit dataflow can make shortcuts substantially smaller and clearer.

## Parameters are not always the pipeline input

An action can explicitly inspect one value while a different value continues to flow through the shortcut.

For example, an `If` action may test a Magic Variable such as `Number`, while the value arriving from the previous action remains the current pipeline value. Selecting `Number` for the condition does not necessarily replace that flowing value with `Number`.

This distinction is easy to miss because the Shortcuts UI emphasizes the value being tested.

## `If` can preserve its incoming value

A minimal observed case:

```text
Number = 1

If Number = 1
    Text "Dog"
End If

If Number = 2
    Text "Cat"
End If

Quick Look → second If Result
```

With `Number = 1`, Quick Look shows `Dog`.

The second condition fails, but its `If Result` is not empty and is not `Number`. The value already flowing into the second `If` survives it. If the branch had run and produced `Cat`, that new value would instead become the result.

A useful working model is therefore:

```text
incoming value
    ↓
If some separately referenced value matches
    produce replacement value
otherwise
    preserve incoming value
    ↓
If Result
```

This is an observed runtime behavior rather than a complete specification of Shortcuts dataflow. Other control-flow actions should be tested separately before assuming identical semantics.

## The compact `If`

The `If` action initially appears bulky because Shortcuts creates it with an `Otherwise` branch. That branch can be removed when nothing needs to happen on the false path.

Combined with passthrough, a compact `If` becomes more useful than it first appears:

```text
If value is applicable
    transform value
End If
```

The action can behave as a conditional transformation: replace the current value when the condition matches, otherwise leave it alone.

## A switch-like pattern

This makes chains of independent tests much closer to a switch or dispatch construct than their visual form suggests.

An explicit version might use a variable solely to carry the selected result:

```text
If input is Image
    Run image shortcut
    Set Variable Result
End If

If input is URL
    Run URL shortcut
    Set Variable Result
End If

If input is Text
    Run text shortcut
    Set Variable Result
End If

Show Result
```

If the tests are mutually exclusive and each matching branch produces the desired replacement value, the pipeline can do that bookkeeping itself:

```text
If input is Image
    Run image shortcut
End If

If input is URL
    Run URL shortcut
End If

If input is Text
    Run text shortcut
End If

Show final If Result
```

A matching branch replaces the flowing value. Later non-matching `If` actions preserve it. The final `If Result` can therefore represent the value surviving the whole chain, rather than only a value created inside the final branch.

This can eliminate repeated `Set Variable` and `Get Variable` actions whose only purpose is to carry a result across control flow.

## Practical rule

When building or simplifying a shortcut, distinguish three things:

- **pipeline value**: the value currently flowing between actions
- **explicit parameter**: a value an action reads or tests
- **produced value**: a value that replaces the pipeline value

Many shortcuts work without making this distinction explicit. Knowing it becomes useful when minimizing control flow, avoiding bookkeeping variables, or reasoning from the serialized plist rather than only from the visual editor.
